import type { ObsEmitterPort } from './observability.constants';
import { summarize } from './sanitize';

export interface RunContext {
  runId: string;
  stepIndex: number;
  totalTokens: number;
  totalCostUsd: number;
  addTokens(input: number, output: number): void;
  addCost(usd: number): void;
}

export function createRunContext(
  _emitter: ObsEmitterPort,
  runId: string,
): RunContext {
  const ctx: RunContext = {
    runId,
    stepIndex: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    addTokens(input: number, output: number) {
      this.totalTokens += (input ?? 0) + (output ?? 0);
    },
    addCost(usd: number) {
      this.totalCostUsd += usd ?? 0;
    },
  };
  return ctx;
}

export async function traceStep<T>(
  emitter: ObsEmitterPort,
  ctx: RunContext,
  name: string,
  tool: string,
  input: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const stepId = emitter.newStepId();
  const index = ctx.stepIndex++;
  const t0 = Date.now();

  emitter.stepStart({
    runId: ctx.runId,
    stepId,
    index,
    name,
    tool,
    input: summarize(input),
  });

  try {
    const result = await fn();
    emitter.stepEnd({
      runId: ctx.runId,
      stepId,
      status: 'ok',
      output: summarize(asRecord(result)),
      latencyMs: Date.now() - t0,
    });
    return result;
  } catch (err) {
    emitter.stepEnd({
      runId: ctx.runId,
      stepId,
      status: 'error',
      output: { error: errorMessage(err) },
      latencyMs: Date.now() - t0,
    });
    throw err;
  }
}

export interface TraceRunOptions {
  runbook: string;
  runId?: string;
  input?: Record<string, unknown>;
}

export async function traceRun<T>(
  emitter: ObsEmitterPort,
  opts: TraceRunOptions,
  fn: (ctx: RunContext) => Promise<T>,
): Promise<T> {
  const runId = opts.runId ?? emitter.newRunId();
  emitter.runStart({
    runId,
    runbook: opts.runbook,
    input: summarize(opts.input ?? {}),
  });
  const ctx = createRunContext(emitter, runId);
  try {
    const result = await fn(ctx);
    emitter.runEnd({
      runId,
      status: 'ok',
      totals: { tokens: ctx.totalTokens, cost_usd: ctx.totalCostUsd },
      output: summarize(asRecord(result)),
    });
    return result;
  } catch (err) {
    emitter.runEnd({
      runId,
      status: 'error',
      totals: { tokens: ctx.totalTokens, cost_usd: ctx.totalCostUsd },
      output: { error: errorMessage(err) },
    });
    throw err;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`.slice(0, 500);
  return String(err).slice(0, 500);
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return { value: String(v).slice(0, 240) };
}
