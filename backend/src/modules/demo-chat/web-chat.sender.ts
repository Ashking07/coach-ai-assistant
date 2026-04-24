import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { DemoWebChatGateway } from './web-chat.gateway';
import type {
  ChannelSendInput,
  ChannelSendResult,
  ChannelSender,
} from '../agent/channels/channel-sender.port';

@Injectable()
export class WebChatSender implements ChannelSender {
  readonly channel = Channel.WEB_CHAT;

  constructor(private readonly gateway: DemoWebChatGateway) {}

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const delivered = this.gateway.sendToParent(input.parentId, input.content);
    if (!delivered) {
      return {
        ok: false,
        error: `No active web chat socket for parent ${input.parentId}`,
      };
    }

    return { ok: true };
  }
}
