import { Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import IORedis from 'ioredis';
import { getRedisUrl } from '../../bullmq.constants';
import { DemoWebChatGateway } from './web-chat.gateway';
import { WEB_CHAT_REPLY_CHANNEL } from './demo-chat.constants';
import type {
  ChannelSendInput,
  ChannelSendResult,
  ChannelSender,
} from '../agent/channels/channel-sender.port';

export { WEB_CHAT_REPLY_CHANNEL };

@Injectable()
export class WebChatSender implements ChannelSender {
  readonly channel = Channel.WEB_CHAT;
  private readonly publisher = new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

  constructor(private readonly gateway: DemoWebChatGateway) {}

  async send(input: ChannelSendInput): Promise<ChannelSendResult> {
    const delivered = this.gateway.sendToParent(input.parentId, input.content);
    if (delivered) {
      return { ok: true };
    }

    // Worker context: gateway has no sockets — publish so the web server delivers it
    await this.publisher.publish(
      WEB_CHAT_REPLY_CHANNEL,
      JSON.stringify({ parentId: input.parentId, content: input.content }),
    );
    return { ok: true };
  }
}
