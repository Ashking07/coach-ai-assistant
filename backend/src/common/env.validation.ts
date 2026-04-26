import { z } from 'zod';

const BoolFlagSchema = z.preprocess((value) => {
  if (value === true || value === 'true' || value === '1' || value === 1) {
    return true;
  }
  if (value === false || value === 'false' || value === '0' || value === 0) {
    return false;
  }
  if (value === undefined || value === null || value === '') {
    return false;
  }
  return value;
}, z.boolean());

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  REDIS_URL: z.string().url().optional(),
  INTERNAL_INGEST_TOKEN: z
    .string()
    .min(16, 'INTERNAL_INGEST_TOKEN must be >=16 chars'),
  DASHBOARD_TOKEN: z.string().min(16, 'DASHBOARD_TOKEN must be >=16 chars'),
  COACH_ID: z.string().min(1, 'COACH_ID must be set'),
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_PHONE_NUMBER: z.string().regex(/^\+[1-9]\d{1,14}$/, 'must be E.164').optional(),
  TWILIO_WEBHOOK_VERIFY_DISABLED: BoolFlagSchema,
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3002'),
  DEMO_PARENT_CHAT_ENABLED: BoolFlagSchema,
  DEMO_TOKEN_SECRET: z.string().optional(),
  VOICE_ENABLED: BoolFlagSchema,
  GEMINI_API_KEY: z.string().min(1).optional(),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().optional(),
  CORS_ORIGIN: z.string().optional(),
  BULLMQ_QUEUE_NAME: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production') {
    if (!env.TWILIO_ACCOUNT_SID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_ACCOUNT_SID'],
        message: 'TWILIO_ACCOUNT_SID is required in production',
      });
    }

    if (!env.TWILIO_AUTH_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_AUTH_TOKEN'],
        message: 'TWILIO_AUTH_TOKEN is required in production',
      });
    }

    if (!env.TWILIO_PHONE_NUMBER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_PHONE_NUMBER'],
        message: 'TWILIO_PHONE_NUMBER is required in production',
      });
    }

    if (env.TWILIO_WEBHOOK_VERIFY_DISABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TWILIO_WEBHOOK_VERIFY_DISABLED'],
        message:
          'TWILIO_WEBHOOK_VERIFY_DISABLED cannot be enabled in production',
      });
    }
  }

  if (env.DEMO_PARENT_CHAT_ENABLED) {
    if (!env.DEMO_TOKEN_SECRET || env.DEMO_TOKEN_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEMO_TOKEN_SECRET'],
        message:
          'DEMO_TOKEN_SECRET must be set and at least 32 characters when DEMO_PARENT_CHAT_ENABLED is enabled',
      });
    }
  }

  if (env.VOICE_ENABLED) {
    if (!env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when VOICE_ENABLED is true',
      });
    }
  }
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
