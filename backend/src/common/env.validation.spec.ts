import { validateEnv } from './env.validation';

const baseEnv = {
  DATABASE_URL: 'https://example.com/db',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  INTERNAL_INGEST_TOKEN: 'x'.repeat(32),
  DASHBOARD_TOKEN: 'y'.repeat(24),
  COACH_ID: 'demo-coach',
  PUBLIC_BASE_URL: 'https://example.com',
  NODE_ENV: 'test',
};

describe('validateEnv', () => {
  it('allows non-production without Twilio credentials', () => {
    expect(() => validateEnv(baseEnv)).not.toThrow();
  });

  it('requires Twilio credentials in production', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
      }),
    ).toThrow(/TWILIO_ACCOUNT_SID|TWILIO_AUTH_TOKEN|TWILIO_PHONE_NUMBER/);
  });

  it('accepts production when Twilio credentials are provided', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        TWILIO_ACCOUNT_SID: 'AC1234567890',
        TWILIO_AUTH_TOKEN: 'twilio-auth-token',
        TWILIO_PHONE_NUMBER: '+15555550123',
      }),
    ).not.toThrow();
  });

  it('requires a strong demo token secret when demo chat is enabled', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        DEMO_PARENT_CHAT_ENABLED: '1',
      }),
    ).toThrow(/DEMO_TOKEN_SECRET/);

    expect(() =>
      validateEnv({
        ...baseEnv,
        DEMO_PARENT_CHAT_ENABLED: '1',
        DEMO_TOKEN_SECRET: 'short-secret',
      }),
    ).toThrow(/DEMO_TOKEN_SECRET/);

    expect(() =>
      validateEnv({
        ...baseEnv,
        DEMO_PARENT_CHAT_ENABLED: '1',
        DEMO_TOKEN_SECRET: 's'.repeat(32),
      }),
    ).not.toThrow();
  });

  it('rejects disabling Twilio webhook verification in production', () => {
    expect(() =>
      validateEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        TWILIO_ACCOUNT_SID: 'AC1234567890',
        TWILIO_AUTH_TOKEN: 'twilio-auth-token',
        TWILIO_PHONE_NUMBER: '+15555550123',
        TWILIO_WEBHOOK_VERIFY_DISABLED: '1',
      }),
    ).toThrow(/TWILIO_WEBHOOK_VERIFY_DISABLED/);
  });
});
