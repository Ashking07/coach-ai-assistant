import { z } from 'zod';
import { AnthropicLlmClient } from './llm.client';
import { LlmOutputError } from './llm.errors';

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

    const client = new AnthropicLlmClient({
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

    const client = new AnthropicLlmClient({
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
});
