import { Module } from '@nestjs/common';
import { CHANNEL_SENDERS } from './channel-sender.constants';
import { ChannelSenderRegistry } from './channel-sender.registry';
import { TwilioSmsSender } from './twilio-sms.sender';

@Module({
  providers: [
    TwilioSmsSender,
    {
      provide: CHANNEL_SENDERS,
      useFactory: (twilioSmsSender: TwilioSmsSender) => [twilioSmsSender],
      inject: [TwilioSmsSender],
    },
    ChannelSenderRegistry,
  ],
  exports: [CHANNEL_SENDERS, ChannelSenderRegistry],
})
export class ChannelSenderModule {}
