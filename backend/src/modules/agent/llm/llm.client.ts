import { Inject, Injectable, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z, type ZodType } from 'zod';
import { CLASSIFICATION_MODEL } from './llm.constants';
import { LlmOutputError } from './llm.errors';
import type { RunContext } from '../../observability/trace-step';
import type { ObsEmitterPort } from '../../observability/observability.constants';
import { OBS_EMITTER } from '../../observability/observability.constants';

export type LlmUsage = {
  tokensIn: number;
  tokensOut: number;
};

export type LlmClassifyResult<T> = {
  parsed: T;
  usage: LlmUsage;
  latencyMs: number;
  model: string;
};

export type LlmClassifyOptions<T> = {
  schema: ZodType<T>;
  systemPrompt: string;
  userPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  runCtx?: RunContext;
};

type AnthropicMessageResponse = {
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  content?: Array<{
    type?: string;
    text?: string;
  }>;
};

type AnthropicLike = {
  messages: {
    create: (
      params: Record<string, unknown>,
    ) => Promise<AnthropicMessageResponse>;
  };
};

export interface LlmClient {
  classify<T>(
    input: string,
    opts: LlmClassifyOptions<T>,
  ): Promise<LlmClassifyResult<T>>;
}

@Injectable()
export class AnthropicLlmClient implements LlmClient {
  private readonly anthropic: AnthropicLike;

  constructor(
    @Inject(OBS_EMITTER) private readonly obs: ObsEmitterPort,
    @Optional()
    @Inject('ANTHROPIC_SDK_CLIENT')
    client?: AnthropicLike,
  ) {
    this.anthropic =
      client ??
      (new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      }) as unknown as AnthropicLike);
  }

  async classify<T>(
    input: string,
    opts: LlmClassifyOptions<T>,
  ): Promise<LlmClassifyResult<T>> {
    const startedAt = Date.now();
    const model = opts.model ?? CLASSIFICATION_MODEL;
    const ctx = opts.runCtx;

    const llmParams = {
      model,
      max_tokens: opts.maxTokens ?? 220,
      temperature: opts.temperature ?? 0,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: opts.userPrompt ?? input }],
    };
    const callLlm = () => this.anthropic.messages.create(llmParams);

    const response = ctx
      ? await this.obs.step('llm.classify', `anthropic.${model}`, callLlm, {
          model,
          promptChars: (opts.userPrompt ?? input).length,
          maxTokens: llmParams.max_tokens,
          temperature: llmParams.temperature,
        })
      : await callLlm();

    const latencyMs = Date.now() - startedAt;
    const firstText = response.content?.find(
      (block): block is { type?: string; text?: string } =>
        typeof block === 'object' && block !== null,
    );

    if (!firstText || firstText.type !== 'text' || !firstText.text) {
      throw new LlmOutputError('LLM output did not contain text content');
    }

    const rawText = firstText.text.trim();

    // Strip markdown code fences if present, then find the JSON object/array
    const stripped = rawText.startsWith('```')
      ? rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      : rawText;

    // Robustly extract the first {...} block in case the model adds preamble text
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : stripped;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (error) {
      throw new LlmOutputError('LLM output was not valid JSON', error, stripped);
    }

    const parsed = opts.schema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new LlmOutputError(
        `LLM output failed schema validation: ${z.prettifyError(parsed.error)}`,
        parsed.error,
      );
    }

    const usage = {
      tokensIn: response.usage?.input_tokens ?? 0,
      tokensOut: response.usage?.output_tokens ?? 0,
    };

    if (ctx) {
      ctx.addTokens(usage.tokensIn, usage.tokensOut);
    }

    return {
      parsed: parsed.data,
      usage,
      latencyMs,
      model: response.model ?? model,
    };
  }
}
