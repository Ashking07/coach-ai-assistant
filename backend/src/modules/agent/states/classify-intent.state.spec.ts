import { Test } from '@nestjs/testing';
import type { Intent } from '@prisma/client';
import { LLM_CLIENT } from '../llm/llm.constants';
import { LlmOutputError } from '../llm/llm.errors';
import { ClassifyIntentState } from './classify-intent.state';

type Fixture = {
  content: string;
  expectedIntent: Intent;
  confidence: number;
  reasoning: string;
};

const FIXTURES: Fixture[] = [
  {
    content: 'Can we book Priya for Thursday at 4pm?',
    expectedIntent: 'BOOK',
    confidence: 0.95,
    reasoning: 'Booking request is explicit',
  },
  {
    content: "Can we move tomorrow's session to Friday?",
    expectedIntent: 'RESCHEDULE',
    confidence: 0.93,
    reasoning: 'Reschedule request is explicit',
  },
  {
    content: "Please cancel this week's training session.",
    expectedIntent: 'CANCEL',
    confidence: 0.94,
    reasoning: 'Cancellation request is explicit',
  },
  {
    content: 'Where should we park for class today?',
    expectedIntent: 'QUESTION_LOGISTICS',
    confidence: 0.9,
    reasoning: 'Asks operational logistics',
  },
  {
    content: 'Can you discount the monthly rate?',
    expectedIntent: 'PAYMENT',
    confidence: 0.88,
    reasoning: 'Mentions rates and discount',
  },
  {
    content: "Thanks coach, you're awesome!",
    expectedIntent: 'SMALLTALK',
    confidence: 0.81,
    reasoning: 'No operational request, just social message',
  },
  {
    content: 'Uhh maybe sometime next month?',
    expectedIntent: 'AMBIGUOUS',
    confidence: 0.74,
    reasoning: 'No clear action requested',
  },
];

describe('ClassifyIntentState', () => {
  let state: ClassifyIntentState;
  const llmClient = { classify: jest.fn() };

  beforeEach(async () => {
    llmClient.classify.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ClassifyIntentState,
        {
          provide: LLM_CLIENT,
          useValue: llmClient,
        },
      ],
    }).compile();

    state = moduleRef.get<ClassifyIntentState>(ClassifyIntentState);
  });

  it.each(FIXTURES)('maps fixture: $expectedIntent', async (fixture) => {
    llmClient.classify.mockResolvedValueOnce({
      parsed: {
        intent: fixture.expectedIntent,
        confidence: fixture.confidence,
        reasoning: fixture.reasoning,
      },
      usage: { tokensIn: 30, tokensOut: 12 },
      model: 'claude-haiku-4-5-20251001',
      latencyMs: 44,
    });

    const result = await state.classifyIntent({
      messageId: 'msg-1',
      content: fixture.content,
      parentKnown: true,
    });

    expect(result.intent).toBe(fixture.expectedIntent);
    expect(result.confidence).toBe(fixture.confidence);
    expect(result.reasoning).toBe(fixture.reasoning);
  });

  it('includes parentKnown signal in prompt payload', async () => {
    llmClient.classify.mockResolvedValueOnce({
      parsed: {
        intent: 'AMBIGUOUS',
        confidence: 0.7,
        reasoning: 'Unknown sender with vague ask',
      },
      usage: { tokensIn: 20, tokensOut: 10 },
      model: 'claude-haiku-4-5-20251001',
      latencyMs: 35,
    });

    await state.classifyIntent({
      messageId: 'msg-unknown',
      content: 'hello can we do something',
      parentKnown: false,
    });

    expect(llmClient.classify).toHaveBeenCalledWith(
      'hello can we do something',
      expect.any(Object),
    );
    const classifyCall = llmClient.classify.mock.calls[0] as [
      string,
      { userPrompt?: string },
    ];
    expect(classifyCall[1].userPrompt).toContain('parentKnown: false');
  });

  it('retries once on LlmOutputError then succeeds', async () => {
    llmClient.classify
      .mockRejectedValueOnce(new LlmOutputError('bad json'))
      .mockResolvedValueOnce({
        parsed: {
          intent: 'BOOK',
          confidence: 0.9,
          reasoning: 'Clear ask',
        },
        usage: { tokensIn: 22, tokensOut: 11 },
        model: 'claude-haiku-4-5-20251001',
        latencyMs: 42,
      });

    const result = await state.classifyIntent({
      messageId: 'msg-retry',
      content: 'book me for friday',
      parentKnown: true,
    });

    expect(result.intent).toBe('BOOK');
    expect(llmClient.classify).toHaveBeenCalledTimes(2);
  });

  it('overrides AMBIGUOUS to BOOK for explicit booking with time details', async () => {
    llmClient.classify.mockResolvedValueOnce({
      parsed: {
        intent: 'AMBIGUOUS',
        confidence: 0.41,
        reasoning: 'Uncertain intent',
      },
      usage: { tokensIn: 24, tokensOut: 9 },
      model: 'claude-haiku-4-5-20251001',
      latencyMs: 40,
    });

    const result = await state.classifyIntent({
      messageId: 'msg-override',
      content: 'Can we book Priya Thursday at 4pm?',
      parentKnown: true,
    });

    expect(result.intent).toBe('BOOK');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.reasoning).toBe('Explicit booking request with time details');
  });

  it('throws after retry is exhausted', async () => {
    llmClient.classify
      .mockRejectedValueOnce(new LlmOutputError('bad json'))
      .mockRejectedValueOnce(new LlmOutputError('still bad json'));

    await expect(
      state.classifyIntent({
        messageId: 'msg-fail',
        content: '???',
        parentKnown: true,
      }),
    ).rejects.toBeInstanceOf(LlmOutputError);
    expect(llmClient.classify).toHaveBeenCalledTimes(2);
  });
});
