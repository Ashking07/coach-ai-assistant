import { Module } from '@nestjs/common';
import { CHANNEL_SENDERS } from './channel-sender.constants';
import { ChannelSenderRegistry } from './channel-sender.registry';
import { TelnyxSmsSender } from './telnyx-sms.sender';
import { DemoChatModule } from '../../demo-chat/demo-chat.module';
import { WebChatSender } from '../../demo-chat/web-chat.sender';

@Module({
  imports: [DemoChatModule],
  providers: [
    TelnyxSmsSender,
    {
      provide: CHANNEL_SENDERS,
      useFactory: (
        telnyxSmsSender: TelnyxSmsSender,
        webChatSender: WebChatSender,
      ) => [telnyxSmsSender, webChatSender],
      inject: [TelnyxSmsSender, WebChatSender],
    },
    ChannelSenderRegistry,
  ],
  exports: [CHANNEL_SENDERS, ChannelSenderRegistry],
})
export class ChannelSenderModule {}
