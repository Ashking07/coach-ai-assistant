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

  async flush(): Promise<void> {}
}
