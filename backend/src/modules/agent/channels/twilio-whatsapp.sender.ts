import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import twilio from 'twilio';
import { PrismaService } from '../../../prisma.service';
import type { ChannelSendInput, ChannelSendResult, ChannelSender } from './channel-sender.port';

const DEFAULT_SANDBOX_FROM = 'whatsapp:+14155238886';

@Injectable()
export class TwilioWhatsAppSender implements ChannelSender {
  readonly channel = Channel.SMS;
  private readonly logger = new Logger(TwilioWhatsAppSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const fromAddress =
      this.config.get<string>('TWILIO_WHATSAPP_FROM') ?? DEFAULT_SANDBOX_FROM;

    if (!accountSid || !authToken) {
      return { ok: false, error: 'Twilio credentials are not configured' };
    }

    const parent = await this.prisma.parent.findUnique({
      where: { id: input.parentId },
      select: { phone: true },
    });

    if (!parent?.phone) {
      return { ok: false, error: `Parent ${input.parentId} does not have a phone` };
    }

    const toAddress = parent.phone.startsWith('whatsapp:')
      ? parent.phone
      : `whatsapp:${parent.phone}`;

    try {
      const client = twilio(accountSid, authToken);
      const message = await client.messages.create({
        to: toAddress,
        from: fromAddress,
        body: input.content,
      });

      return {
        ok: true,
        providerMessageId: message.sid,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown Twilio error';
      this.logger.error(`Twilio WhatsApp send failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
