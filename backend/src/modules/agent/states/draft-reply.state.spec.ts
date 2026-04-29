import { Test } from '@nestjs/testing';
import { DraftReplyState } from './draft-reply.state';
import { LLM_CLIENT } from '../llm/llm.constants';
import type { LlmClient } from '../llm/llm.client';
import { ConfidenceTier } from '@prisma/client';

function makeMockMessage() {
  return {
    id: 'msg-1',
    coachId: 'coach-1',
    parentId: 'parent-1',
    content: 'Can we book Priya Thursday?',
    direction: 'INBOUND' as const,
    channel: 'WEB_CHAT' as const,
    providerMessageId: 'web-1',
    receivedAt: new Date(),
    processedAt: null,
  };
}

function makeMockContext(
  slotLabel: string | null = 'Thursday Apr 24, 9:00–10:00 AM',
) {
  return {
    parent: { id: 'parent-1', name: 'Alice Chen' },
    kids: [{ id: 'kid-1', name: 'Priya' }],
    recentMessages: [],
    upcomingSessions: [],
    availableSlots: slotLabel
      ? [
          {
            startAt: new Date('2026-04-24T16:00:00Z'),
            endAt: new Date('2026-04-24T17:00:00Z'),
            label: slotLabel,
          },
        ]
      : [],
  };
}

describe('DraftReplyState', () => {
  let state: DraftReplyState;
  let mockLlm: jest.Mocked<LlmClient>;

  beforeEach(async () => {
    mockLlm = {
      classify: jest.fn().mockResolvedValue({
        parsed: {
          reply:
            'Hi Alice! Priya has a slot Thursday Apr 24, 9:00–10:00 AM — does that work?',
        },
        usage: { tokensIn: 80, tokensOut: 25 },
        latencyMs: 320,
        model: 'claude-sonnet-4-6',
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [DraftReplyState, { provide: LLM_CLIENT, useValue: mockLlm }],
    }).compile();

    state = moduleRef.get<DraftReplyState>(DraftReplyState);
  });

  it('calls LLM with Sonnet model and slot labels in user prompt', async () => {
    const result = await state.draft({
      message: makeMockMessage(),

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      context: makeMockContext() as any,
      intent: 'BOOK',
      tier: ConfidenceTier.AUTO,
    });

    expect(result.draft).toContain('Thursday');
    expect(result.usage.tokensIn).toBe(80);
    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.latencyMs).toBe(320);

    const callOpts = mockLlm.classify.mock.calls[0]?.[1] as {
      model: string;
      maxTokens: number;
      userPrompt: string;
    };
    expect(callOpts.model).toBe('claude-sonnet-4-6');
    expect(callOpts.maxTokens).toBe(400);
    expect(callOpts.userPrompt).toContain('Thursday Apr 24, 9:00–10:00 AM');
  });

  it('instructs LLM with "No available slots" when slots are empty', async () => {
    mockLlm.classify.mockResolvedValueOnce({
      parsed: {
        reply:
          "Hi Alice! I'll check with the coach on availability for Priya and get back to you.",
      },
      usage: { tokensIn: 70, tokensOut: 20 },
      latencyMs: 280,
      model: 'claude-sonnet-4-6',
    });

    await state.draft({
      message: makeMockMessage(),

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      context: makeMockContext(null) as any,
      intent: 'BOOK',
      tier: ConfidenceTier.APPROVE,
    });

    const callOpts = mockLlm.classify.mock.calls[0]?.[1] as {
      userPrompt: string;
    };
    expect(callOpts.userPrompt).toContain('No available slots');
  });

  it('passes APPROVE tier hint when tier is APPROVE', async () => {
    await state.draft({
      message: makeMockMessage(),

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      context: makeMockContext() as any,
      intent: 'RESCHEDULE',
      tier: ConfidenceTier.APPROVE,
    });

    const callOpts = mockLlm.classify.mock.calls[0]?.[1] as {
      userPrompt: string;
    };
    expect(callOpts.userPrompt).toContain('coach will review before sending');
  });
});
