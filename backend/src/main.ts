import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DemoWebChatGateway } from './modules/demo-chat/web-chat.gateway';
import { VoiceGateway } from './modules/voice/voice.gateway';
import { MessagesService } from './modules/messages/messages.service';
import { startWorker } from './worker';

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

  // Run BullMQ worker in-process so we don't need a separate Render service
  const messagesService = app.get(MessagesService);
  const recovered = await messagesService.recoverOrphanedMessages();
  if (recovered > 0) console.log(`Recovered ${recovered} orphaned messages on boot`);
  startWorker(messagesService);
}
void bootstrap();
