import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule bootstrap env validation', () => {
  const originalIngestToken = process.env.INTERNAL_INGEST_TOKEN;
  const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalIngestToken === undefined) {
      delete process.env.INTERNAL_INGEST_TOKEN;
    } else {
      process.env.INTERNAL_INGEST_TOKEN = originalIngestToken;
    }

    if (originalAnthropicKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    }
  });

  it('throws when INTERNAL_INGEST_TOKEN is missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    delete process.env.INTERNAL_INGEST_TOKEN;
    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).rejects.toThrow(/INTERNAL_INGEST_TOKEN/);
  });

  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    process.env.INTERNAL_INGEST_TOKEN = 'x'.repeat(32);
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it('boots when required env vars are set', async () => {
    process.env.INTERNAL_INGEST_TOKEN = 'x'.repeat(32);
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
