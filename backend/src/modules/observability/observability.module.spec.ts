import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { ObservabilityModule } from './observability.module';
import { OBS_EMITTER } from './observability.constants';
import { NoopObsEmitter } from './noop-emitter';

describe('ObservabilityModule', () => {
  it('returns a noop emitter when VERIOPS_ENABLED=false', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ VERIOPS_ENABLED: false })],
        }),
        ObservabilityModule,
      ],
    }).compile();

    const emitter = moduleRef.get(OBS_EMITTER);
    expect(emitter).toBeInstanceOf(NoopObsEmitter);
  });

  it('returns a real emitter when enabled (does not network)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({
            VERIOPS_ENABLED: true,
            OBS_BASE_URL: 'http://localhost:9999',
            OBS_API_KEY: 'fake',
            OBS_PROJECT_ID: 'demo',
          })],
        }),
        ObservabilityModule,
      ],
    }).compile();

    const emitter = moduleRef.get(OBS_EMITTER);
    expect(typeof emitter.newRunId).toBe('function');
    expect(emitter.newRunId()).toMatch(/^run_/);
  });
});
