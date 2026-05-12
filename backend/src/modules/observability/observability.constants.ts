export const OBS_EMITTER = Symbol('OBS_EMITTER');

export interface ObsRunStartParams {
  runId: string;
  runbook: string;
  input?: Record<string, unknown>;
}

export interface ObsRunEndParams {
  runId: string;
  status?: 'ok' | 'error';
  totals?: { tokens?: number; cost_usd?: number };
  output?: Record<string, unknown>;
}

export interface ObsStepStartParams {
  runId: string;
  stepId: string;
  index: number;
  name: string;
  tool: string;
  input?: Record<string, unknown>;
}

export interface ObsStepEndParams {
  runId: string;
  stepId: string;
  status: 'ok' | 'error';
  output?: Record<string, unknown>;
  latencyMs: number;
  tokens?: number;
  costUsd?: number;
}

export interface ObsEmitterPort {
  newRunId(): string;
  newStepId(): string;
  runStart(params: ObsRunStartParams): void;
  runEnd(params: ObsRunEndParams): void;
  stepStart(params: ObsStepStartParams): void;
  stepEnd(params: ObsStepEndParams): void;
  step<T>(name: string, tool: string, fn: () => Promise<T>, input?: Record<string, unknown>): Promise<T>;
  withRunContext<T>(runId: string, runbook: string, fn: () => Promise<T>): Promise<T>;
  flush(): Promise<void>;
}
