import { Module } from '@nestjs/common';
import { DemoController } from './demo.controller';
import { DemoTokenService } from './demo-token.service';
import { DemoWebChatGateway } from './web-chat.gateway';
import { WebChatSender } from './web-chat.sender';

@Module({
  controllers: [DemoController],
  providers: [DemoTokenService, DemoWebChatGateway, WebChatSender],
  exports: [DemoTokenService, DemoWebChatGateway, WebChatSender],
})
export class DemoChatModule {}
