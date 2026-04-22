import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullMqModule } from './bullmq.module';
import { MessagesModule } from './modules/messages/messages.module';
import { validateEnv } from './common/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
    }),
    BullMqModule,
    MessagesModule,
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
