import { Module } from '@nestjs/common';
import { CHANNEL_SENDERS } from './channel-sender.constants';
import { ChannelSenderRegistry } from './channel-sender.registry';
import { TwilioWhatsAppSender } from './twilio-whatsapp.sender';
import { DemoChatModule } from '../../demo-chat/demo-chat.module';
import { WebChatSender } from '../../demo-chat/web-chat.sender';

@Module({
  imports: [DemoChatModule],
  providers: [
    TwilioWhatsAppSender,
    {
      provide: CHANNEL_SENDERS,
      useFactory: (
        twilioWhatsAppSender: TwilioWhatsAppSender,
        webChatSender: WebChatSender,
      ) => [twilioWhatsAppSender, webChatSender],
      inject: [TwilioWhatsAppSender, WebChatSender],
    },
    ChannelSenderRegistry,
  ],
  exports: [CHANNEL_SENDERS, ChannelSenderRegistry],
})
export class ChannelSenderModule {}
