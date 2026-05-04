import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe?: ReturnType<StripeService['createStripe']>;
  private readonly refreshUrl?: string;
  private readonly returnUrl?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.refreshUrl = this.config.get<string>('STRIPE_CONNECT_REFRESH_URL');
    this.returnUrl = this.config.get<string>('STRIPE_CONNECT_RETURN_URL');
    if (secretKey) {
      this.stripe = this.createStripe(secretKey);
    }
  }

  private createStripe(secretKey: string) {
    return new Stripe(secretKey, { apiVersion: '2026-03-25.dahlia' });
  }

  private requireStripe() {
    if (!this.stripe) {
      throw new InternalServerErrorException('Stripe is not configured');
    }
    return this.stripe;
  }

  async createConnectAccount(coachId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    if (!this.refreshUrl || !this.returnUrl) {
      throw new BadRequestException('Stripe connect URLs are not configured');
    }

    const coach = await this.prisma.coach.findUnique({
      where: { id: coachId },
      select: { stripeAccountId: true, name: true },
    });
    if (!coach) throw new BadRequestException('Coach not found');

    let accountId = coach.stripeAccountId;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        metadata: { coachId },
        business_profile: { name: coach.name },
      });
      accountId = account.id;
      await this.prisma.coach.update({
        where: { id: coachId },
        data: { stripeAccountId: accountId },
      });
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: this.refreshUrl,
      return_url: this.returnUrl,
      type: 'account_onboarding',
    });

    return { url: link.url };
  }

  async refreshConnectStatus(coachId: string): Promise<void> {
    const stripe = this.requireStripe();
    const coach = await this.prisma.coach.findUnique({
      where: { id: coachId },
      select: { stripeAccountId: true },
    });
    if (!coach?.stripeAccountId) {
      throw new BadRequestException('Stripe account not connected');
    }

    const account = await stripe.accounts.retrieve(coach.stripeAccountId);
    await this.prisma.coach.update({
      where: { id: coachId },
      data: {
        stripeChargesEnabled: account.charges_enabled,
        stripeOnboardingDone: account.details_submitted,
      },
    });
  }

  async createCheckoutForSession(
    sessionId: string,
    coachId: string,
  ): Promise<{ url: string; checkoutId: string }> {
    const stripe = this.requireStripe();
    const coach = await this.prisma.coach.findUnique({
      where: { id: coachId },
      select: { stripeAccountId: true, name: true },
    });
    if (!coach?.stripeAccountId) {
      throw new BadRequestException('Stripe account not connected');
    }

    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, coachId },
      include: { kid: { include: { parent: true } } },
    });
    if (!session) throw new BadRequestException('Session not found');

    if (session.priceCents <= 0) {
      throw new BadRequestException('Session price is not set');
    }

    const label = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(session.scheduledAt);

    const idempotencyKey = `session-${sessionId}`;

    const checkout = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: session.priceCents,
              product_data: {
                name: `Session — ${session.kid.name} ${label}`,
              },
            },
            quantity: 1,
          },
        ],
        success_url: `${this.config.get('PUBLIC_BASE_URL') ?? 'http://localhost:3002'}/api/stripe/return?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.config.get('PUBLIC_BASE_URL') ?? 'http://localhost:3002'}/api/stripe/return?cancelled=1`,
        metadata: { sessionId, coachId },
        payment_intent_data: { metadata: { sessionId, coachId } },
      },
      { stripeAccount: coach.stripeAccountId, idempotencyKey },
    );

    await this.prisma.payment.create({
      data: {
        coachId,
        sessionId,
        amountCents: session.priceCents,
        method: 'STRIPE',
        status: 'PENDING',
        stripeCheckoutId: checkout.id,
        recordedBy: 'auto',
      },
    });

    if (!checkout.url) {
      this.logger.error({ event: 'STRIPE_CHECKOUT_URL_MISSING', sessionId });
      throw new InternalServerErrorException('Stripe checkout URL missing');
    }

    return { url: checkout.url, checkoutId: checkout.id };
  }
}
