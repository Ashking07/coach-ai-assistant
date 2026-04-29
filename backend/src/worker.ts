import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import {
  MESSAGE_INGESTED_JOB,
  getQueueName,
  getRedisUrl,
} from './bullmq.constants';
import { AppModule } from './app.module';
import { MessagesService } from './modules/messages/messages.service';
import {
  OBS_EMITTER,
  type ObsEmitterPort,
} from './modules/observability/observability.constants';

const MessageIngestedPayload = z.object({ messageId: z.string().min(1) });

export function startWorker(messagesService: MessagesService) {
  const queueName = getQueueName();
  const connection = new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      if (job.name === MESSAGE_INGESTED_JOB) {
        const { messageId } = MessageIngestedPayload.parse(job.data);

        const processed =
          await messagesService.processIngestedMessage(messageId);
        if (!processed) {
          return { ok: true, skipped: 'already_processed' };
        }

        return { ok: true };
      }

      const message = (job.data as { message?: string })?.message ?? 'hello';
      console.log(`Received: ${message}`);
      return { ok: true };
    },
    { connection },
  );

  worker.on('completed', (job) => {
    console.log(`Completed job ${job.id} (${job.name}) from ${queueName}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed in ${queueName}`, error);
  });

  console.log(`Worker listening on queue ${queueName}`);

  return {
    worker,
    connection,
    close: async () => {
      await worker.close();
      await connection.quit();
    },
  };
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const messagesService = app.get(MessagesService);
  const obs = app.get<ObsEmitterPort>(OBS_EMITTER);

  const recovered = await messagesService.recoverOrphanedMessages();
  if (recovered > 0) {
    console.log(`Recovered ${recovered} orphaned messages on boot`);
  }

  const { close } = startWorker(messagesService);

  const shutdown = async () => {
    await close();
    try {
      await obs.flush();
    } catch {}
    await app.close();
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
}

if (require.main === module) {
  void bootstrap();
}
