import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullMqModule } from './bullmq.module';
import { PrismaModule } from './prisma.module';
import { AgentModule } from './modules/agent/agent.module';
import { MessagesModule } from './modules/messages/messages.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { TwilioModule } from './modules/twilio/twilio.module';
import { TelnyxModule } from './modules/telnyx/telnyx.module';
import { DemoChatModule } from './modules/demo-chat/demo-chat.module';
import { VoiceModule } from './modules/voice/voice.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { validateEnv } from './common/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
    }),
    ObservabilityModule,
    BullMqModule,
    PrismaModule,
    AgentModule,
    MessagesModule,
    DashboardModule,
    TwilioModule,
    TelnyxModule,
    DemoChatModule,
    VoiceModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: 'ENV_VALIDATION',
      useFactory: () => validateEnv(process.env),
    },
    AppService,
  ],
})
export class AppModule {}
