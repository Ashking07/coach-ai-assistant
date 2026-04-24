import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getQueueName, getRedisUrl } from './bullmq.constants';

export const TEST_JOB_QUEUE = Symbol('TEST_JOB_QUEUE');

@Global()
@Module({
  providers: [
    {
      provide: TEST_JOB_QUEUE,
      useFactory: () => {
        const connection = new IORedis(getRedisUrl(), {
          maxRetriesPerRequest: null,
        });

        const queue = new Queue(getQueueName(), { connection });

        return queue;
      },
    },
  ],
  exports: [TEST_JOB_QUEUE],
})
export class BullMqModule {}
