import { Module } from '@nestjs/common';
import { MessagesModule } from '../messages/messages.module';
import { TwilioController } from './twilio.controller';
import { TwilioSignatureGuard } from './twilio-signature.guard';

@Module({
  imports: [MessagesModule],
  controllers: [TwilioController],
  providers: [TwilioSignatureGuard],
})
export class TwilioModule {}
