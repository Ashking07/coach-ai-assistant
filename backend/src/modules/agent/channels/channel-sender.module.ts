import { Module } from '@nestjs/common';
import { CHANNEL_SENDERS } from './channel-sender.constants';
import { ChannelSenderRegistry } from './channel-sender.registry';
import { TwilioSmsSender } from './twilio-sms.sender';
import { DemoChatModule } from '../../demo-chat/demo-chat.module';
import { WebChatSender } from '../../demo-chat/web-chat.sender';

@Module({
  imports: [DemoChatModule],
  providers: [
    TwilioSmsSender,
    {
      provide: CHANNEL_SENDERS,
      useFactory: (
        twilioSmsSender: TwilioSmsSender,
        webChatSender: WebChatSender,
      ) => [twilioSmsSender, webChatSender],
      inject: [TwilioSmsSender, WebChatSender],
    },
    ChannelSenderRegistry,
  ],
  exports: [CHANNEL_SENDERS, ChannelSenderRegistry],
})
export class ChannelSenderModule {}
