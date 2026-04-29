import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import type { ChannelSendInput, ChannelSendResult, ChannelSender } from './channel-sender.port';

@Injectable()
export class TelnyxSmsSender implements ChannelSender {
  readonly channel = Channel.SMS;
  private readonly logger = new Logger(TelnyxSmsSender.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const apiKey = this.config.get<string>('TELNYX_API_KEY');
    const fromPhone = this.config.get<string>('TELNYX_PHONE_NUMBER');

    if (!apiKey || !fromPhone) {
      return { ok: false, error: 'Telnyx credentials are not configured' };
    }

    const parent = await this.prisma.parent.findUnique({
      where: { id: input.parentId },
      select: { phone: true },
    });

    if (!parent?.phone) {
      return { ok: false, error: `Parent ${input.parentId} does not have a phone` };
    }

    try {
      const response = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          from: fromPhone,
          to: parent.phone,
          text: input.content,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(`Telnyx send failed: ${response.status} ${errorBody}`);
        return { ok: false, error: `Telnyx API error: ${response.status}` };
      }

      const data = (await response.json()) as { data?: { id?: string } };
      return {
        ok: true,
        providerMessageId: data.data?.id ?? 'unknown',
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown Telnyx error';
      return { ok: false, error: msg };
    }
  }
}
