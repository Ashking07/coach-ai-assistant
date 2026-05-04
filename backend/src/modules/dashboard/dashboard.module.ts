import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma.module';
import { ChannelSenderModule } from '../agent/channels/channel-sender.module';
import { StripeModule } from '../stripe/stripe.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [PrismaModule, ChannelSenderModule, StripeModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
