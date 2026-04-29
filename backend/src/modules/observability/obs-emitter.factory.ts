import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ObsEmitterPort } from './observability.constants';
import { NoopObsEmitter } from './noop-emitter';

const logger = new Logger('ObsEmitterFactory');

export async function createObsEmitter(
  config: ConfigService,
): Promise<ObsEmitterPort> {
  const enabled = config.get<boolean>('VERIOPS_ENABLED');
  if (!enabled) {
    logger.log({ event: 'OBS_DISABLED' });
    return new NoopObsEmitter();
  }

  // Jest ESM workaround: avoid importing SDK during tests (not business logic).
  if (process.env.JEST_WORKER_ID) {
    logger.log({ event: 'OBS_DISABLED_TEST' });
    return new NoopObsEmitter();
  }

  const baseUrl = config.getOrThrow<string>('OBS_BASE_URL');
  const apiKey = config.getOrThrow<string>('OBS_API_KEY');
  const projectId = config.getOrThrow<string>('OBS_PROJECT_ID');

  const { ObsEmitter } = await import('@veriops/sdk-js');
  const emitter = new ObsEmitter({ baseUrl, apiKey, projectId });
  logger.log({ event: 'OBS_INITIALIZED', baseUrl, projectId });

  // The SDK's underlying methods may throw if the network is unreachable.
  // Wrap each call so a VeriOps outage never breaks the host app.
  return {
    newRunId: () => emitter.newRunId(),
    newStepId: () => emitter.newStepId(),
    runStart: (p) => safe(() => emitter.runStart(p), 'runStart'),
    runEnd: (p) =>
      safe(() => emitter.runEnd({ runId: p.runId, totals: p.totals ?? {} }), 'runEnd'),
    stepStart: (p) =>
      safe(
        () => emitter.stepStart({ ...p, input: p.input ?? {} }),
        'stepStart',
      ),
    stepEnd: (p) =>
      safe(
        () =>
          emitter.stepEnd({
            runId: p.runId,
            stepId: p.stepId,
            status: p.status,
            output: p.output ?? {},
            latencyMs: p.latencyMs,
            tokens: p.tokens,
            costUsd: p.costUsd,
          }),
        'stepEnd',
      ),
    flush: async () => {
      try {
        await emitter.flush();
      } catch (err) {
        logger.warn({ event: 'OBS_FLUSH_FAILED', err: String(err) });
      }
    },
  };
}

function safe(fn: () => void, op: string): void {
  try {
    fn();
  } catch (err) {
    logger.warn({ event: `OBS_${op.toUpperCase()}_FAILED`, err: String(err) });
  }
}
