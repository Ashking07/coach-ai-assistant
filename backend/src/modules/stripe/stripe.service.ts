import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma.service';
import { ChannelSenderRegistry } from '../agent/channels/channel-sender.registry';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe?: ReturnType<StripeService['createStripe']>;
  private readonly refreshUrl?: string;
  private readonly returnUrl?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly channelSenders: ChannelSenderRegistry,
  ) {
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    const backendBase =
      this.config.get<string>('PUBLIC_BASE_URL') ??
      'https://coach-ai-assistant-backend.onrender.com';
    const frontendBase =
      this.config.get<string>('FRONTEND_URL') ??
      'https://coach-ai-assistant-frontend.vercel.app';
    this.refreshUrl =
      this.config.get<string>('STRIPE_CONNECT_REFRESH_URL') ??
      `${backendBase}/api/dashboard/stripe/onboard/return`;
    this.returnUrl =
      this.config.get<string>('STRIPE_CONNECT_RETURN_URL') ??
      `${frontendBase}/settings?stripe_return=1`;
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
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      await this.prisma.coach.update({
        where: { id: coachId },
        data: { stripeAccountId: accountId },
      });
    } else {
      // Ensure capabilities are requested on existing accounts (idempotent)
      await stripe.accounts.update(accountId, {
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
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

    // Ensure capabilities are requested (idempotent — safe to call every time)
    await stripe.accounts.update(coach.stripeAccountId, {
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    const account = await stripe.accounts.retrieve(coach.stripeAccountId);

    this.logger.log({
      event: 'STRIPE_REFRESH',
      accountId: coach.stripeAccountId,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      capabilities: account.capabilities,
      requirements_currently_due: (account.requirements as { currently_due?: string[] } | null)?.currently_due,
      requirements_disabled_reason: (account.requirements as { disabled_reason?: string } | null)?.disabled_reason,
    });

    await this.prisma.coach.update({
      where: { id: coachId },
      data: {
        stripeChargesEnabled: account.charges_enabled,
        stripeOnboardingDone: account.details_submitted,
      },
    });
  }

  async getAccountDebug(coachId: string) {
    const stripe = this.requireStripe();
    const coach = await this.prisma.coach.findUnique({
      where: { id: coachId },
      select: { stripeAccountId: true },
    });
    if (!coach?.stripeAccountId) throw new BadRequestException('No Stripe account');
    const account = await stripe.accounts.retrieve(coach.stripeAccountId);
    return {
      id: account.id,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      capabilities: account.capabilities,
      requirements: account.requirements,
    };
  }

  async createExpressLoginLink(coachId: string): Promise<{ url: string }> {
    const stripe = this.requireStripe();
    const coach = await this.prisma.coach.findUnique({
      where: { id: coachId },
      select: { stripeAccountId: true },
    });
    if (!coach?.stripeAccountId) throw new BadRequestException('No Stripe account connected');
    const link = await stripe.accounts.createLoginLink(coach.stripeAccountId);
    return { url: link.url };
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

  async sendPaymentReceipt(checkoutSessionId: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { stripeCheckoutId: checkoutSessionId },
      include: {
        session: {
          include: {
            kid: { include: { parent: true } },
            coach: { select: { id: true, timezone: true } },
          },
        },
      },
    });

    if (!payment?.session) {
      this.logger.warn({ event: 'RECEIPT_SESSION_NOT_FOUND', checkoutSessionId });
      return;
    }

    const { session } = payment;
    const { kid } = session;
    const { parent } = kid;

    const dateStr = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: session.coach?.timezone ?? 'America/Los_Angeles',
    }).format(session.scheduledAt);

    const amount = `$${(payment.amountCents / 100).toFixed(2)}`;
    const body = `Payment received! ✓ ${amount} for ${kid.name}'s session on ${dateStr}. Thank you!`;

    try {
      const sender = this.channelSenders.get(parent.preferredChannel);
      await sender.send({
        coachId: session.coachId,
        messageId: `receipt-${checkoutSessionId}`,
        parentId: parent.id,
        content: body,
      });
      this.logger.log({ event: 'RECEIPT_SENT', checkoutSessionId, parentId: parent.id });
    } catch (err) {
      this.logger.error({ event: 'RECEIPT_SEND_FAILED', checkoutSessionId, err });
    }
  }
}
