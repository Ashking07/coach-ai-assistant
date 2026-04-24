export const DEV_TEST_QUEUE = 'coach-dev-test-jobs';

export const MESSAGE_INGESTED_JOB = 'MESSAGE_INGESTED';

export function getRedisUrl() {
  return process.env.REDIS_URL ?? 'redis://localhost:6380';
}

export function getQueueName() {
  return process.env.BULLMQ_QUEUE_NAME ?? DEV_TEST_QUEUE;
}
