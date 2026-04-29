import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DemoWebChatGateway } from './modules/demo-chat/web-chat.gateway';
import { VoiceGateway } from './modules/voice/voice.gateway';
import { MessagesService } from './modules/messages/messages.service';
import { startWorker } from './worker';
import {
  OBS_EMITTER,
  type ObsEmitterPort,
} from './modules/observability/observability.constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = (
    process.env.CORS_ORIGIN ??
    'http://localhost:5173,http://localhost:5174,https://coach-ai-assistant-backend.onrender.com'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  const gateway = app.get(DemoWebChatGateway);
  const httpServer = app.getHttpServer() as import('node:http').Server;
  gateway.attachToHttpServer(httpServer);

  const voiceGateway = app.get(VoiceGateway);
  voiceGateway.attachToHttpServer(httpServer);

  await app.listen(process.env.PORT ?? 3002);

  const obs = app.get<ObsEmitterPort>(OBS_EMITTER);
  const shutdown = async () => {
    try {
      await obs.flush();
    } catch {
      // Best-effort flush; never block shutdown.
    }
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });

  // Run BullMQ worker in-process so we don't need a separate Render service
  const messagesService = app.get(MessagesService);
  const recovered = await messagesService.recoverOrphanedMessages();
  if (recovered > 0) console.log(`Recovered ${recovered} orphaned messages on boot`);
  startWorker(messagesService);
}
void bootstrap();
