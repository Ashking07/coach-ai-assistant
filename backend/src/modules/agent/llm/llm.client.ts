import { Inject, Injectable, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { z, type ZodType } from 'zod';
import { CLASSIFICATION_MODEL } from './llm.constants';
import { LlmOutputError } from './llm.errors';

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

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 220,
      temperature: opts.temperature ?? 0,
      system: opts.systemPrompt,
      messages: [
        {
          role: 'user',
          content: opts.userPrompt ?? input,
        },
      ],
    });

    const latencyMs = Date.now() - startedAt;
    const firstText = response.content?.find(
      (block): block is { type?: string; text?: string } =>
        typeof block === 'object' && block !== null,
    );

    if (!firstText || firstText.type !== 'text' || !firstText.text) {
      throw new LlmOutputError('LLM output did not contain text content');
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(firstText.text);
    } catch (error) {
      throw new LlmOutputError('LLM output was not valid JSON', error);
    }

    const parsed = opts.schema.safeParse(parsedJson);
    if (!parsed.success) {
      throw new LlmOutputError(
        `LLM output failed schema validation: ${z.prettifyError(parsed.error)}`,
        parsed.error,
      );
    }

    return {
      parsed: parsed.data,
      usage: {
        tokensIn: response.usage?.input_tokens ?? 0,
        tokensOut: response.usage?.output_tokens ?? 0,
      },
      latencyMs,
      model: response.model ?? model,
    };
  }
}
