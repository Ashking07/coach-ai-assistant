import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullMqModule } from './bullmq.module';
import { PrismaService } from './prisma.service';
import { validateEnv } from './common/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
    }),
    BullMqModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: 'ENV_VALIDATION',
      useFactory: () => validateEnv(process.env as Record<string, unknown>),
    },
    AppService,
    PrismaService,
  ],
})
export class AppModule {}
