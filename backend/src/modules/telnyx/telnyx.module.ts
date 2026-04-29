import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { TelnyxController } from './telnyx.controller';

@Module({
  imports: [MessagesModule],
  controllers: [TelnyxController],
})
export class TelnyxModule {}
