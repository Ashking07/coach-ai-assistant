import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { DEV_TEST_QUEUE, getRedisUrl } from './bullmq.constants';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const redisUrl = getRedisUrl();
  const queueName = process.env.BULLMQ_QUEUE_NAME ?? DEV_TEST_QUEUE;

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      const message = job.data?.message ?? 'hello';
      console.log(`Received: ${message}`);
      return { ok: true };
    },
    { connection },
  );

  worker.on('completed', (job) => {
    console.log(`Completed job ${job.id} from ${queueName}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} failed in ${queueName}`, error);
  });

  const shutdown = async () => {
    await worker.close();
    await connection.quit();
    await app.close();
  };

  process.on('SIGINT', () => {
    void shutdown();
  });

  process.on('SIGTERM', () => {
    void shutdown();
  });
}

void bootstrap();