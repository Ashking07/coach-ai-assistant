import { Inject, Injectable } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { CHANNEL_SENDERS } from './channel-sender.constants';
import type { ChannelSender } from './channel-sender.port';

@Injectable()
export class ChannelSenderRegistry {
  private readonly sendersByChannel: Map<Channel, ChannelSender>;

  constructor(
    @Inject(CHANNEL_SENDERS)
    senders: ChannelSender[],
  ) {
    this.sendersByChannel = new Map(
      senders.map((sender) => [sender.channel, sender]),
    );
  }

  get(channel: Channel): ChannelSender {
    const sender = this.sendersByChannel.get(channel);
    if (!sender) {
      throw new Error(`No channel sender registered for ${channel}`);
    }
    return sender;
  }
}
