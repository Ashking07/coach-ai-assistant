import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma.service';
import type { Request } from 'express';

type StripeRequest = Request & { body: Buffer };

@Controller('api/stripe')
export class StripeWebhookController {
  private readonly secret?: string;
  private readonly connectSecret?: string;
  private readonly secretKey?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    this.connectSecret = this.config.get<string>(
      'STRIPE_CONNECT_WEBHOOK_SECRET',
    );
  }

  @Post('webhook')
  async handleWebhook(
    @Req() req: StripeRequest,
    @Headers('stripe-signature') signature?: string,
    @Headers('stripe-account') stripeAccount?: string,
  ): Promise<{ ok: true }> {
    if (!signature) {
      throw new BadRequestException('Missing Stripe signature');
    }
    if (!this.secretKey) {
      throw new BadRequestException('Stripe is not configured');
    }
    const secret = stripeAccount ? this.connectSecret : this.secret;
    if (!secret) {
      throw new BadRequestException('Stripe webhook secret not configured');
    }

    let event: { type: string; id: string; data: { object: unknown } };
    try {
      const stripe = new Stripe(this.secretKey, {
        apiVersion: '2026-03-25.dahlia',
      });
      const rawBody = req.body as Buffer;
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException('Invalid Stripe signature');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as {
        id: string;
        metadata?: { sessionId?: string; coachId?: string };
        payment_intent?: string | null;
      };
      const sessionId = session.metadata?.sessionId;
      const coachId = session.metadata?.coachId;
      if (sessionId && coachId) {
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.payment.findFirst({
            where: { stripeEventId: event.id },
            select: { id: true },
          });
          if (existing) return;

          await tx.payment.updateMany({
            where: { stripeCheckoutId: session.id },
            data: {
              status: 'PAID',
              stripeEventId: event.id,
              stripePaymentIntent:
                typeof session.payment_intent === 'string'
                  ? session.payment_intent
                  : null,
              paidAt: new Date(),
              recordedBy: 'stripe-webhook',
            },
          });

          await tx.session.update({
            where: { id: sessionId },
            data: { paid: true, paymentMethod: 'STRIPE', paidAt: new Date() },
          });
        });
      }
    }

    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as { id: string };
      await this.prisma.payment.updateMany({
        where: { stripeCheckoutId: session.id },
        data: { status: 'CANCELLED', stripeEventId: event.id },
      });
    }

    if (event.type === 'charge.refunded') {
      const charge = event.data.object as { payment_intent?: string | null };
      if (typeof charge.payment_intent === 'string') {
        await this.prisma.payment.updateMany({
          where: { stripePaymentIntent: charge.payment_intent },
          data: {
            status: 'REFUNDED',
            stripeEventId: event.id,
            refundedAt: new Date(),
          },
        });
      }
    }

    return { ok: true };
  }
}
