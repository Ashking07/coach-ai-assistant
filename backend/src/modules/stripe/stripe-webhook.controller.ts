import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma.service';
import { StripeService } from './stripe.service';
import type { Request, Response } from 'express';

type StripeRequest = Request & { body: Buffer };

@Controller('api/stripe')
export class StripeWebhookController {
  private readonly secret?: string;
  private readonly connectSecret?: string;
  private readonly secretKey?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stripeService: StripeService,
  ) {
    this.secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    this.connectSecret = this.config.get<string>(
      'STRIPE_CONNECT_WEBHOOK_SECRET',
    );
  }

  @Get('return')
  async handleReturn(
    @Query('session_id') checkoutSessionId: string | undefined,
    @Query('cancelled') cancelled: string | undefined,
    @Res() res: Response,
  ) {
    const frontendBase =
      this.config.get<string>('FRONTEND_URL') ??
      'https://coach-ai-assistant-frontend.vercel.app';

    if (cancelled) {
      return res.redirect(`${frontendBase}?payment=cancelled`);
    }

    if (checkoutSessionId) {
      try {
        const payment = await this.prisma.payment.findFirst({
          where: { stripeCheckoutId: checkoutSessionId },
          select: { id: true, sessionId: true, status: true },
        });
        if (payment && payment.status !== 'PAID') {
          await this.prisma.$transaction([
            this.prisma.payment.updateMany({
              where: { stripeCheckoutId: checkoutSessionId },
              data: { status: 'PAID', paidAt: new Date(), recordedBy: 'return-url' },
            }),
            this.prisma.session.update({
              where: { id: payment.sessionId },
              data: { paid: true, paymentMethod: 'STRIPE', paidAt: new Date() },
            }),
          ]);
          // Fire-and-forget: send receipt to parent; never block the redirect
          void this.stripeService.sendPaymentReceipt(checkoutSessionId);
        }
      } catch {
        // webhook handles the authoritative mark-paid; don't fail the redirect
      }
    }

    return res.redirect(`${frontendBase}?payment=success`);
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

        // Send receipt only if return-url didn't already handle it
        const paid = await this.prisma.payment.findFirst({
          where: { stripeCheckoutId: session.id },
          select: { recordedBy: true },
        });
        if (paid?.recordedBy !== 'return-url') {
          void this.stripeService.sendPaymentReceipt(session.id);
        }
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
