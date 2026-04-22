import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule bootstrap env validation', () => {
  const originalEnv = process.env.INTERNAL_INGEST_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.INTERNAL_INGEST_TOKEN;
    } else {
      process.env.INTERNAL_INGEST_TOKEN = originalEnv;
    }
  });

  it('throws when INTERNAL_INGEST_TOKEN is missing', async () => {
    delete process.env.INTERNAL_INGEST_TOKEN;
    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).rejects.toThrow(/INTERNAL_INGEST_TOKEN/);
  });

  it('boots when INTERNAL_INGEST_TOKEN is set', async () => {
    process.env.INTERNAL_INGEST_TOKEN = 'x'.repeat(32);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
