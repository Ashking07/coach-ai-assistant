import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { DEV_TEST_QUEUE, getRedisUrl } from './bullmq.constants';

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

        const queue = new Queue(DEV_TEST_QUEUE, { connection });

        return queue;
      },
    },
  ],
  exports: [TEST_JOB_QUEUE],
})
export class BullMqModule {}