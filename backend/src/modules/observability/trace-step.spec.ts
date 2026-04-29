import { NoopObsEmitter } from './noop-emitter';
import type {
  ObsEmitterPort,
  ObsStepStartParams,
  ObsStepEndParams,
  ObsRunStartParams,
  ObsRunEndParams,
} from './observability.constants';
import { createRunContext, traceStep, traceRun } from './trace-step';

class RecordingEmitter implements ObsEmitterPort {
  starts: ObsStepStartParams[] = [];
  ends: ObsStepEndParams[] = [];
  runStarts: ObsRunStartParams[] = [];
  runEnds: ObsRunEndParams[] = [];
  newRunId() {
    return 'run_test';
  }
  newStepId() {
    return `step_${this.starts.length}`;
  }
  runStart(p: ObsRunStartParams) {
    this.runStarts.push(p);
  }
  runEnd(p: ObsRunEndParams) {
    this.runEnds.push(p);
  }
  stepStart(p: ObsStepStartParams) {
    this.starts.push(p);
  }
  stepEnd(p: ObsStepEndParams) {
    this.ends.push(p);
  }
  async flush() {}
}

describe('traceStep', () => {
  it('emits stepStart + stepEnd around a successful function', async () => {
    const e = new RecordingEmitter();
    const ctx = createRunContext(e, 'run_1');
    const result = await traceStep(
      e,
      ctx,
      'classify',
      'agent.classify',
      { content: 'hi' },
      async () => ({ intent: 'BOOK' }),
    );
    expect(result).toEqual({ intent: 'BOOK' });
    expect(e.starts).toHaveLength(1);
    expect(e.starts[0].index).toBe(0);
    expect(e.starts[0].name).toBe('classify');
    expect(e.ends).toHaveLength(1);
    expect(e.ends[0].status).toBe('ok');
  });

  it('increments step index across calls', async () => {
    const e = new RecordingEmitter();
    const ctx = createRunContext(e, 'run_1');
    await traceStep(e, ctx, 'a', 'tool.a', {}, async () => 1);
    await traceStep(e, ctx, 'b', 'tool.b', {}, async () => 2);
    expect(e.starts.map((s) => s.index)).toEqual([0, 1]);
  });

  it('records error status and rethrows when fn throws', async () => {
    const e = new RecordingEmitter();
    const ctx = createRunContext(e, 'run_1');
    await expect(
      traceStep(e, ctx, 'boom', 'tool.boom', {}, async () => {
        throw new Error('bang');
      }),
    ).rejects.toThrow('bang');
    expect(e.ends[0].status).toBe('error');
    expect(e.ends[0].output?.error).toContain('bang');
  });

  it('measures latency', async () => {
    const e = new RecordingEmitter();
    const ctx = createRunContext(e, 'run_1');
    await traceStep(e, ctx, 'wait', 'tool.wait', {}, async () => {
      await new Promise((r) => setTimeout(r, 12));
    });
    expect(e.ends[0].latencyMs).toBeGreaterThanOrEqual(10);
  });
});

describe('traceRun', () => {
  it('wraps the body in runStart + runEnd with totals', async () => {
    const e = new RecordingEmitter();
    const result = await traceRun(
      e,
      { runbook: 'agent.message_pipeline' },
      async (ctx) => {
        await traceStep(e, ctx, 's1', 't1', {}, async () => {
          ctx.addTokens(10, 5);
          ctx.addCost(0.0001);
        });
        return 42;
      },
    );
    expect(result).toBe(42);
    expect(e.runStarts).toHaveLength(1);
    expect(e.runEnds).toHaveLength(1);
    expect(e.runEnds[0].totals?.tokens).toBe(15);
    expect(e.runEnds[0].totals?.cost_usd).toBeCloseTo(0.0001);
    expect(e.runEnds[0].status).toBe('ok');
  });

  it('records error status when body throws and rethrows', async () => {
    const e = new RecordingEmitter();
    await expect(
      traceRun(e, { runbook: 'rb' }, async () => {
        throw new Error('fail');
      }),
    ).rejects.toThrow('fail');
    expect(e.runEnds[0].status).toBe('error');
  });
});
