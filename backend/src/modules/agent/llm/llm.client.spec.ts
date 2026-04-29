import { z } from 'zod';
import { AnthropicLlmClient } from './llm.client';
import { LlmOutputError } from './llm.errors';
import { NoopObsEmitter } from '../../observability/noop-emitter';

describe('AnthropicLlmClient.classify', () => {
  it('calls SDK with expected shape and returns parsed output', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 21, output_tokens: 9 },
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            intent: 'BOOK',
            confidence: 0.92,
            reasoning: 'Clear booking request',
          }),
        },
      ],
    });

    const client = new AnthropicLlmClient(new NoopObsEmitter(), {
      messages: { create },
    });

    const schema = z.object({
      intent: z.enum(['BOOK', 'AMBIGUOUS']),
      confidence: z.number(),
      reasoning: z.string(),
    });

    const result = await client.classify('Can we book Thursday?', {
      schema,
      systemPrompt: 'Classify intent',
      userPrompt: 'messageId: msg-1\\ncontent: Can we book Thursday?',
      model: 'claude-haiku-4-5-20251001',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        system: 'Classify intent',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: 'messageId: msg-1\\ncontent: Can we book Thursday?',
          },
        ],
      }),
    );
    expect(result.parsed.intent).toBe('BOOK');
    expect(result.usage).toEqual({ tokensIn: 21, tokensOut: 9 });
  });

  it('throws LlmOutputError when Zod parse fails', async () => {
    const create = jest.fn().mockResolvedValue({
      model: 'claude-haiku-4-5-20251001',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            intent: 'BOOK',
            confidence: 2,
            reasoning: 'invalid confidence',
          }),
        },
      ],
    });

    const client = new AnthropicLlmClient(new NoopObsEmitter(), {
      messages: { create },
    });

    const schema = z.object({
      intent: z.enum(['BOOK', 'AMBIGUOUS']),
      confidence: z.number().max(1),
      reasoning: z.string(),
    });

    await expect(
      client.classify('book', {
        schema,
        systemPrompt: 'Classify intent',
      }),
    ).rejects.toBeInstanceOf(LlmOutputError);
  });

  describe('classify with runCtx', () => {
    it('emits stepStart and stepEnd on the emitter', async () => {
      const calls: { kind: string; payload: any }[] = [];
      const recording = {
        newRunId: () => 'run_x',
        newStepId: () => 'step_x',
        runStart: (p: any) => calls.push({ kind: 'runStart', payload: p }),
        runEnd: (p: any) => calls.push({ kind: 'runEnd', payload: p }),
        stepStart: (p: any) => calls.push({ kind: 'stepStart', payload: p }),
        stepEnd: (p: any) => calls.push({ kind: 'stepEnd', payload: p }),
        flush: async () => {},
      };
      const fakeAnthropic = {
        messages: {
          create: async () => ({
            model: 'claude-test',
            usage: { input_tokens: 11, output_tokens: 7 },
            content: [{ type: 'text', text: '{"ok": true}' }],
          }),
        },
      };
      const client = new AnthropicLlmClient(
        recording as any,
        fakeAnthropic as any,
      );
      const ctx = {
        runId: 'run_x',
        stepIndex: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        addTokens(i: number, o: number) {
          this.totalTokens += i + o;
        },
        addCost() {},
      };
      await client.classify('hi', {
        schema: z.object({ ok: z.boolean() }),
        systemPrompt: 'sys',
        runCtx: ctx as any,
      });
      expect(calls.map((c) => c.kind)).toEqual(['stepStart', 'stepEnd']);
      expect(calls[1].payload.status).toBe('ok');
      expect(calls[1].payload.output.tokensIn).toBe(11);
      expect(ctx.totalTokens).toBe(18);
    });
  });
});
