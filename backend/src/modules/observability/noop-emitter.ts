import { randomUUID } from 'node:crypto';
import type { ObsEmitterPort } from './observability.constants';

export class NoopObsEmitter implements ObsEmitterPort {
  newRunId(): string {
    return `run_${randomUUID()}`;
  }

  newStepId(): string {
    return `step_${randomUUID()}`;
  }

  runStart(): void {}

  runEnd(): void {}

  stepStart(): void {}

  stepEnd(): void {}

  async step<T>(_name: string, _tool: string, fn: () => Promise<T>, _input?: Record<string, unknown>): Promise<T> {
    return fn();
  }

  async withRunContext<T>(_runId: string, _runbook: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async flush(): Promise<void> {}
}
