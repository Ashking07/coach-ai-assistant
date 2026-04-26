import { Module } from '@nestjs/common';
import { VoiceGateway } from './voice.gateway';
import { VoiceController } from './voice.controller';
import { CoachCommandService } from './coach-command.service';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [DashboardModule],
  providers: [VoiceGateway, CoachCommandService],
  controllers: [VoiceController],
  exports: [VoiceGateway],
})
export class VoiceModule {}
