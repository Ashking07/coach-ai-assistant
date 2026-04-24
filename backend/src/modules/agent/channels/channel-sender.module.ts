import { Module } from '@nestjs/common';
import { CHANNEL_SENDERS } from './channel-sender.constants';
import { ChannelSenderRegistry } from './channel-sender.registry';

@Module({
  providers: [
    {
      provide: CHANNEL_SENDERS,
      useValue: [],
    },
    ChannelSenderRegistry,
  ],
  exports: [CHANNEL_SENDERS, ChannelSenderRegistry],
})
export class ChannelSenderModule {}
