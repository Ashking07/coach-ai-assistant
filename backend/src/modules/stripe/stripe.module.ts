import { Module } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { ChannelSenderModule } from '../agent/channels/channel-sender.module';

@Module({
  imports: [ChannelSenderModule],
  providers: [StripeService],
  controllers: [StripeWebhookController],
  exports: [StripeService],
})
export class StripeModule {}
