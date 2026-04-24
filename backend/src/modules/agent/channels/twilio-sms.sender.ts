import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import twilio from 'twilio';
import { PrismaService } from '../../../prisma.service';
import type { ChannelSendInput, ChannelSendResult, ChannelSender } from './channel-sender.port';

@Injectable()
export class TwilioSmsSender implements ChannelSender {
  readonly channel = Channel.SMS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const fromPhone = this.config.get<string>('TWILIO_PHONE_NUMBER');

    if (!accountSid || !authToken || !fromPhone) {
      return { ok: false, error: 'Twilio credentials are not configured' };
    }

    const parent = await this.prisma.parent.findUnique({
      where: { id: input.parentId },
      select: { phone: true },
    });

    if (!parent?.phone) {
      return { ok: false, error: `Parent ${input.parentId} does not have a phone` };
    }

    try {
      const client = twilio(accountSid, authToken);
      const message = await client.messages.create({
        to: parent.phone,
        from: fromPhone,
        body: input.content,
      });

      return {
        ok: true,
        providerMessageId: message.sid,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown Twilio error';
      return {
        ok: false,
        error: msg,
      };
    }
  }
}
