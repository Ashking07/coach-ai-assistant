import { Module } from '@nestjs/common';
import { TwilioController } from './twilio.controller';
import { TwilioSignatureGuard } from './twilio-signature.guard';

@Module({
  controllers: [TwilioController],
  providers: [TwilioSignatureGuard],
})
export class TwilioModule {}
