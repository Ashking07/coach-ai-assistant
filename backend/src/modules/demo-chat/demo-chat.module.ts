import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { MessagesModule } from '../messages/messages.module';
import { DemoController } from './demo.controller';
import { DemoTokenService } from './demo-token.service';
import { DemoWebChatGateway } from './web-chat.gateway';
import { WebChatSender } from './web-chat.sender';

@Module({
  imports: [PrismaModule, MessagesModule],
  controllers: [DemoController],
  providers: [DemoTokenService, DemoWebChatGateway, WebChatSender],
  exports: [DemoTokenService, DemoWebChatGateway, WebChatSender],
})
export class DemoChatModule {}
