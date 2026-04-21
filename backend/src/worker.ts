import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { getQueueName, getRedisUrl } from './bullmq.constants';
import { AppModule } from './app.module';

export function startWorker() {
  const queueName = getQueueName();
  const connection = new IORedis(getRedisUrl(), {
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
  const { close } = startWorker();

  const shutdown = async () => {
    await close();
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
