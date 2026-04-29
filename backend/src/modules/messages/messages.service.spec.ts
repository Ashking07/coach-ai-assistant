import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../prisma.service';
import { TEST_JOB_QUEUE } from '../../bullmq.module';
import type { ParentMessage } from '@coach/shared';
import { ClassifyIntentState } from '../agent/states/classify-intent.state';
import { LoadContextState } from '../agent/states/load-context.state';
import { PolicyGate } from '../agent/gates/policy-gate';
import { ConfidenceGate } from '../agent/gates/confidence-gate';
import { DraftReplyState } from '../agent/states/draft-reply.state';
import { OutboundService } from '../agent/outbound/outbound.service';
import { ConfidenceTier } from '@prisma/client';
import { NoopObsEmitter } from '../observability/noop-emitter';
import {
  OBS_EMITTER,
  type ObsEmitterPort,
} from '../observability/observability.constants';

const baseMsg: ParentMessage = {
  coachId: 'demo-coach',
  channel: 'WEB_CHAT',
  fromPhone: '+15555550001',
  fromName: 'Jane',
  content: 'hi',
  providerMessageId: 'web-uuid-1',
  receivedAt: new Date('2026-04-21T12:00:00Z'),
};

function makePrismaMock() {
  return {
    parent: { findUnique: jest.fn(), upsert: jest.fn() },
    message: { findUnique: jest.fn(), create: jest.fn() },
  };
}

function makeQueueMock() {
  return { add: jest.fn() };
}

function makeOutboundMock() {
  return {
    autoSend: jest.fn().mockResolvedValue(undefined),
    queueForApproval: jest.fn().mockResolvedValue(undefined),
    escalate: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── ingest ──────────────────────────────────────────────────────────────────

describe('MessagesService.ingest', () => {
  let service: MessagesService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let queue: ReturnType<typeof makeQueueMock>;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    prisma = makePrismaMock();
    queue = makeQueueMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TEST_JOB_QUEUE, useValue: queue },
        {
          provide: ClassifyIntentState,
          useValue: { classifyIntent: jest.fn() },
        },
        { provide: LoadContextState, useValue: { loadContext: jest.fn() } },
        { provide: PolicyGate, useValue: { check: jest.fn() } },
        { provide: ConfidenceGate, useValue: { determine: jest.fn() } },
        { provide: DraftReplyState, useValue: { draft: jest.fn() } },
        { provide: OutboundService, useValue: makeOutboundMock() },
        { provide: OBS_EMITTER, useValue: new NoopObsEmitter() },
      ],
    }).compile();
    service = moduleRef.get<MessagesService>(MessagesService);
    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    logSpy = jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => {});
    warnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => {});
    /* eslint-enable @typescript-eslint/no-unsafe-member-access */
  });

  it('fresh phone creates unverified Parent, logs UNKNOWN_PARENT_CREATED, enqueues', async () => {
    const now = new Date('2026-04-21T12:00:00Z');
    prisma.parent.findUnique.mockResolvedValue(null);
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      coachId: 'demo-coach',
      phone: '+15555550001',
      createdAt: now,
    });
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue({ id: 'msg-1' });
    queue.add.mockResolvedValue({ id: 'job-1' });

    const result = await service.ingest(baseMsg);

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    expect(prisma.parent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          coachId_phone: { coachId: 'demo-coach', phone: '+15555550001' },
        },
        create: expect.objectContaining({ name: 'Jane' }),
      }),
    );
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coachId: 'demo-coach',
          parentId: 'parent-1',
          direction: 'INBOUND',
          channel: 'WEB_CHAT',
          providerMessageId: 'web-uuid-1',
          content: 'hi',
        }),
      }),
    );
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    expect(queue.add).toHaveBeenCalledWith('MESSAGE_INGESTED', {
      messageId: 'msg-1',
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'UNKNOWN_PARENT_CREATED',
        parentId: 'parent-1',
      }),
      'MessagesService',
    );
    expect(result).toEqual({
      messageId: 'msg-1',
      duplicate: false,
      enqueued: true,
      jobId: 'job-1',
    });
  });

  it('known phone does not log UNKNOWN_PARENT_CREATED', async () => {
    prisma.parent.findUnique.mockResolvedValue({ id: 'parent-1' });
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      createdAt: new Date('2026-01-01'),
    });
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue({ id: 'msg-2' });
    queue.add.mockResolvedValue({ id: 'job-2' });

    await service.ingest(baseMsg);

    const unknownCalls = logSpy.mock.calls.filter((c) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const entry = c[0] as Record<string, unknown>;
      return entry?.event === 'UNKNOWN_PARENT_CREATED';
    });
    expect(unknownCalls).toHaveLength(0);
  });

  it('duplicate (channel, providerMessageId) returns early without enqueue', async () => {
    prisma.parent.findUnique.mockResolvedValue({ id: 'parent-1' });
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      createdAt: new Date('2026-01-01'),
    });
    prisma.message.findUnique.mockResolvedValue({ id: 'existing-msg-id' });

    const result = await service.ingest(baseMsg);

    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'DUPLICATE_MESSAGE_DROPPED',
        messageId: 'existing-msg-id',
      }),
      'MessagesService',
    );
    expect(result).toEqual({
      messageId: 'existing-msg-id',
      duplicate: true,
      enqueued: false,
      jobId: null,
    });
  });

  it('DB commit happens before enqueue', async () => {
    prisma.parent.findUnique.mockResolvedValue({ id: 'parent-1' });
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      createdAt: new Date('2026-01-01'),
    });
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue({ id: 'msg-3' });
    queue.add.mockRejectedValue(new Error('redis down'));

    await expect(service.ingest(baseMsg)).rejects.toThrow('redis down');
    expect(prisma.message.create).toHaveBeenCalled();
    const createOrder = prisma.message.create.mock.invocationCallOrder[0];
    const addOrder = queue.add.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(addOrder);
  });
});

// ─── processIngestedMessage ───────────────────────────────────────────────────

function makeProcessPrismaMock() {
  return {
    agentDecision: { findFirst: jest.fn(), create: jest.fn() },
    message: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    coach: { findUniqueOrThrow: jest.fn() },
  };
}

const CLASSIFY_RESULT = {
  intent: 'BOOK' as const,
  confidence: 0.92,
  reasoning: 'Explicit booking request',
  usage: { tokensIn: 35, tokensOut: 12 },
  model: 'claude-haiku-4-5-20251001',
  latencyMs: 111,
};

const CONTEXT_WITH_SLOTS = {
  parent: {
    id: 'parent-1',
    name: 'Alice',
    isVerified: true,
    preferredChannel: 'WEB_CHAT',
  },
  kids: [{ id: 'kid-1', name: 'Priya' }],
  recentMessages: [],
  upcomingSessions: [],
  availableSlots: [
    {
      startAt: new Date(),
      endAt: new Date(),
      label: 'Thursday Apr 24, 9:00–10:00 AM',
    },
  ],
};

const DRAFT_RESULT = {
  draft:
    'Hi Alice! Thursday Apr 24, 9:00–10:00 AM is available — does that work?',
  usage: { tokensIn: 80, tokensOut: 25 },
  model: 'claude-sonnet-4-6',
  latencyMs: 320,
};

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    coachId: 'coach-1',
    parentId: 'parent-1',
    content: 'Can we book Priya on Thursday?',
    parent: { id: 'parent-1', isVerified: true, preferredChannel: 'WEB_CHAT' },
    ...overrides,
  };
}

describe('MessagesService.processIngestedMessage', () => {
  let service: MessagesService;
  let prisma: ReturnType<typeof makeProcessPrismaMock>;
  let classifyMock: { classifyIntent: jest.Mock };
  let contextMock: { loadContext: jest.Mock };
  let policyMock: { check: jest.Mock };
  let confidenceMock: { determine: jest.Mock };
  let draftMock: { draft: jest.Mock };
  let outboundMock: ReturnType<typeof makeOutboundMock>;
  let obsEmitter: ObsEmitterPort;

  beforeEach(async () => {
    prisma = makeProcessPrismaMock();
    classifyMock = { classifyIntent: jest.fn() };
    contextMock = { loadContext: jest.fn() };
    policyMock = { check: jest.fn().mockReturnValue(null) };
    confidenceMock = {
      determine: jest.fn().mockReturnValue(ConfidenceTier.AUTO),
    };
    draftMock = { draft: jest.fn() };
    outboundMock = makeOutboundMock();
    obsEmitter = new NoopObsEmitter();
    prisma.coach.findUniqueOrThrow.mockResolvedValue({ agentPaused: false });

    const moduleRef = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TEST_JOB_QUEUE, useValue: { add: jest.fn() } },
        { provide: ClassifyIntentState, useValue: classifyMock },
        { provide: LoadContextState, useValue: contextMock },
        { provide: PolicyGate, useValue: policyMock },
        { provide: ConfidenceGate, useValue: confidenceMock },
        { provide: DraftReplyState, useValue: draftMock },
        { provide: OutboundService, useValue: outboundMock },
        { provide: OBS_EMITTER, useValue: obsEmitter },
      ],
    }).compile();

    service = moduleRef.get<MessagesService>(MessagesService);
  });

  it('returns false when AgentDecision already exists (idempotent)', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue({ id: 'decision-1' });
    const result = await service.processIngestedMessage('msg-1');
    expect(result).toBe(false);
    expect(classifyMock.classifyIntent).not.toHaveBeenCalled();
  });

  it('happy path: BOOK + known parent + slots → autoSend called, processedAt set', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.message.findUniqueOrThrow.mockResolvedValue(makeMessage());
    classifyMock.classifyIntent.mockResolvedValue(CLASSIFY_RESULT);
    contextMock.loadContext.mockResolvedValue(CONTEXT_WITH_SLOTS);
    confidenceMock.determine.mockReturnValue(ConfidenceTier.AUTO);
    draftMock.draft.mockResolvedValue(DRAFT_RESULT);

    const result = await service.processIngestedMessage('msg-1');

    expect(result).toBe(true);
    expect(outboundMock.autoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        classifyResult: CLASSIFY_RESULT,
        draftResult: DRAFT_RESULT,
      }),
    );
    expect(outboundMock.queueForApproval).not.toHaveBeenCalled();
    expect(outboundMock.escalate).not.toHaveBeenCalled();
    expect(prisma.message.update).toHaveBeenCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ data: { processedAt: expect.any(Date) } }),
    );
  });

  it('RESCHEDULE → queueForApproval called', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.message.findUniqueOrThrow.mockResolvedValue(
      makeMessage({ content: 'Can we move Thursday session?' }),
    );
    classifyMock.classifyIntent.mockResolvedValue({
      ...CLASSIFY_RESULT,
      intent: 'RESCHEDULE',
    });
    contextMock.loadContext.mockResolvedValue(CONTEXT_WITH_SLOTS);
    confidenceMock.determine.mockReturnValue(ConfidenceTier.APPROVE);
    draftMock.draft.mockResolvedValue(DRAFT_RESULT);

    await service.processIngestedMessage('msg-1');

    expect(outboundMock.queueForApproval).toHaveBeenCalled();
    expect(outboundMock.autoSend).not.toHaveBeenCalled();
  });

  it('PolicyGate fires → escalate called with classify data, draft not called', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.message.findUniqueOrThrow.mockResolvedValue(
      makeMessage({ content: 'Can I get a discount?' }),
    );
    classifyMock.classifyIntent.mockResolvedValue(CLASSIFY_RESULT);
    contextMock.loadContext.mockResolvedValue(CONTEXT_WITH_SLOTS);
    policyMock.check.mockReturnValue({
      tier: 'ESCALATE',
      reason: 'Sensitive keyword detected',
    });

    await service.processIngestedMessage('msg-1');

    expect(draftMock.draft).not.toHaveBeenCalled();
    expect(outboundMock.escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        actionTaken: 'ESCALATED',
        reason: 'Sensitive keyword detected',
        classifyResult: CLASSIFY_RESULT,
      }),
    );
    expect(prisma.message.update).toHaveBeenCalled();
  });

  it('classify fails → CLASSIFY_FAILED escalation, processedAt set, no classify data', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.message.findUniqueOrThrow.mockResolvedValue(makeMessage());
    classifyMock.classifyIntent.mockRejectedValue(new Error('llm down'));

    await service.processIngestedMessage('msg-1');

    expect(outboundMock.escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        actionTaken: 'CLASSIFY_FAILED',
        classifyResult: undefined,
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const escalateCall = outboundMock.escalate.mock.calls[0]?.[0] as {
      reason: string;
    };
    expect(escalateCall.reason).toContain('llm down');
    expect(prisma.message.update).toHaveBeenCalled();
    expect(draftMock.draft).not.toHaveBeenCalled();
  });

  it('draft fails → DRAFT_FAILED escalation preserving classify data, processedAt set', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.message.findUniqueOrThrow.mockResolvedValue(makeMessage());
    classifyMock.classifyIntent.mockResolvedValue(CLASSIFY_RESULT);
    contextMock.loadContext.mockResolvedValue(CONTEXT_WITH_SLOTS);
    confidenceMock.determine.mockReturnValue(ConfidenceTier.AUTO);
    draftMock.draft.mockRejectedValue(new Error('sonnet timeout'));

    await service.processIngestedMessage('msg-1');

    expect(outboundMock.escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        actionTaken: 'DRAFT_FAILED',
        classifyResult: CLASSIFY_RESULT,
      }),
    );
    expect(prisma.message.update).toHaveBeenCalled();
  });

  it('validateDraft downgrades AUTO→APPROVE when draft mentions unlisted time', async () => {
    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.message.findUniqueOrThrow.mockResolvedValue(makeMessage());
    classifyMock.classifyIntent.mockResolvedValue(CLASSIFY_RESULT);
    contextMock.loadContext.mockResolvedValue(CONTEXT_WITH_SLOTS);
    confidenceMock.determine.mockReturnValue(ConfidenceTier.AUTO);
    // Draft invents a time not in the slot label (slot says "Thursday Apr 24, 9:00–10:00 AM")
    draftMock.draft.mockResolvedValue({
      ...DRAFT_RESULT,
      draft: 'Hi Alice! I have Saturday at 3:00 PM available!',
    });

    await service.processIngestedMessage('msg-1');

    // Saturday and 3:00 not in slot label → downgraded to APPROVE
    expect(outboundMock.queueForApproval).toHaveBeenCalled();
    expect(outboundMock.autoSend).not.toHaveBeenCalled();
  });

  it('emits one run with ordered steps', async () => {
    class RecordingObsEmitter implements ObsEmitterPort {
      starts: any[] = [];
      ends: any[] = [];
      runStarts: any[] = [];
      runEnds: any[] = [];
      newRunId() {
        return 'run_t';
      }
      newStepId() {
        return `step_${this.starts.length}`;
      }
      runStart(p: any) {
        this.runStarts.push(p);
      }
      runEnd(p: any) {
        this.runEnds.push(p);
      }
      stepStart(p: any) {
        this.starts.push(p);
      }
      stepEnd(p: any) {
        this.ends.push(p);
      }
      async flush() {}
    }

    const obs = new RecordingObsEmitter();
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessagesService,
        { provide: PrismaService, useValue: prisma },
        { provide: TEST_JOB_QUEUE, useValue: { add: jest.fn() } },
        { provide: ClassifyIntentState, useValue: classifyMock },
        { provide: LoadContextState, useValue: contextMock },
        { provide: PolicyGate, useValue: policyMock },
        { provide: ConfidenceGate, useValue: confidenceMock },
        { provide: DraftReplyState, useValue: draftMock },
        { provide: OutboundService, useValue: outboundMock },
        { provide: OBS_EMITTER, useValue: obs },
      ],
    }).compile();

    const obsService = moduleRef.get<MessagesService>(MessagesService);

    prisma.agentDecision.findFirst.mockResolvedValue(null);
    prisma.message.findUniqueOrThrow.mockResolvedValue(makeMessage());
    classifyMock.classifyIntent.mockResolvedValue(CLASSIFY_RESULT);
    contextMock.loadContext.mockResolvedValue(CONTEXT_WITH_SLOTS);
    confidenceMock.determine.mockReturnValue(ConfidenceTier.AUTO);
    draftMock.draft.mockResolvedValue(DRAFT_RESULT);

    await obsService.processIngestedMessage('msg-1');

    expect(obs.runStarts).toHaveLength(1);
    expect(obs.runEnds).toHaveLength(1);
    const stepNames = obs.starts.map((s) => s.name);
    expect(stepNames).toContain('classify_intent');
    expect(stepNames).toContain('confidence_gate');
    expect(stepNames).toContain('draft_reply');
    const indices = obs.starts.map((s) => s.index);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });
});
