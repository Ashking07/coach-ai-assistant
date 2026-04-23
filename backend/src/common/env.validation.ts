import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  REDIS_URL: z.string().url().optional(),
  INTERNAL_INGEST_TOKEN: z
    .string()
    .min(16, 'INTERNAL_INGEST_TOKEN must be >=16 chars'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().optional(),
  CORS_ORIGIN: z.string().optional(),
  BULLMQ_QUEUE_NAME: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}
