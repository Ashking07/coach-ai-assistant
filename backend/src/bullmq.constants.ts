export const DEV_TEST_QUEUE = 'coach-dev-test-jobs';

export function getRedisUrl() {
  return process.env.REDIS_URL ?? 'redis://localhost:6380';
}