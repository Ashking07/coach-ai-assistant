import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { startWorker } from './worker';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,https://coach-ai-assistant-backend.onrender.com')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  if (process.env.RUN_WORKER_INLINE !== 'false') {
    startWorker();
  }

  await app.listen(process.env.PORT ?? 3002);
}
bootstrap();
