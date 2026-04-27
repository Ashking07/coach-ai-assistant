import { Test } from '@nestjs/testing';
import { OutboundService } from './outbound.service';
import { PrismaService } from '../../../prisma.service';
import { ConfidenceTier } from '@prisma/client';
import { ChannelSenderRegistry } from '../channels/channel-sender.registry';
import type { ChannelSender } from '../channels/channel-sender.port';

function makePrisma() {
  return {
    message: { create: jest.fn().mockResolvedValue({ id: 'out-msg-1' }) },
    agentDecision: {
      create: jest.fn().mockResolvedValue({ id: 'decision-1' }),
    },
    approvalQueue: {
      create: jest.fn().mockResolvedValue({ id: 'approval-1' }),
    },
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

const DRAFT_RESULT = {
  draft: 'Hi Alice! Thursday 9:00 AM works — confirmed!',
  usage: { tokensIn: 80, tokensOut: 25 },
  model: 'claude-sonnet-4-6',
  latencyMs: 320,
};

const BASE = {
  coachId: 'coach-1',
  messageId: 'msg-1',
  parentId: 'parent-1',
  channel: 'WEB_CHAT' as const,
};

describe('OutboundService', () => {
  let service: OutboundService;
  let prisma: ReturnType<typeof makePrisma>;
  let sender: ChannelSender;
  let channelSenderRegistry: { get: jest.Mock };

  beforeEach(async () => {
    prisma = makePrisma();
    sender = {
      channel: 'WEB_CHAT',
      send: jest.fn().mockResolvedValue({ ok: true }),
    } as unknown as ChannelSender;
    channelSenderRegistry = {
      get: jest.fn().mockReturnValue(sender),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OutboundService,
        { provide: PrismaService, useValue: prisma },
        { provide: ChannelSenderRegistry, useValue: channelSenderRegistry },
      ],
    }).compile();
    service = moduleRef.get<OutboundService>(OutboundService);
  });

  describe('autoSend', () => {
    it('writes OUTBOUND message then AUTO_SENT AgentDecision and calls channel sender', async () => {
      await service.autoSend({
        ...BASE,
        classifyResult: CLASSIFY_RESULT,
        draftResult: DRAFT_RESULT,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const msgArgs = prisma.message.create.mock.calls[0]?.[0] as {
        data: { direction: string; content: string; coachId: string };
      };
      expect(msgArgs.data.direction).toBe('OUTBOUND');
      expect(msgArgs.data.content).toBe(DRAFT_RESULT.draft);
      expect(msgArgs.data.coachId).toBe('coach-1');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const decisionArgs = prisma.agentDecision.create.mock.calls[0]?.[0] as {
        data: {
          actionTaken: string;
          tier: string;
          intent: string;
          confidence: number;
        };
      };
      expect(decisionArgs.data.actionTaken).toBe('AUTO_SENT');
      expect(decisionArgs.data.tier).toBe(ConfidenceTier.AUTO);
      expect(decisionArgs.data.intent).toBe('BOOK');
      expect(decisionArgs.data.confidence).toBe(0.92);

      expect(channelSenderRegistry.get).toHaveBeenCalledWith('WEB_CHAT');
      expect(sender.send).toHaveBeenCalledWith({
        coachId: 'coach-1',
        messageId: 'msg-1',
        parentId: 'parent-1',
        content: DRAFT_RESULT.draft,
      });
    });

    it('appends DELIVERY_FAILED when channel sender returns an error', async () => {
      sender.send = jest.fn().mockResolvedValue({
        ok: false,
        error: 'provider unavailable',
      });
      channelSenderRegistry.get.mockReturnValue(sender);

      await service.autoSend({
        ...BASE,
        classifyResult: CLASSIFY_RESULT,
        draftResult: DRAFT_RESULT,
      });

      expect(prisma.agentDecision.create).toHaveBeenCalledTimes(2);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const failureDecisionArgs = prisma.agentDecision.create.mock.calls[1]?.[0] as {
        data: { actionTaken: string; reasoning: string; tier: string };
      };
      expect(failureDecisionArgs.data.actionTaken).toBe('DELIVERY_FAILED');
      expect(failureDecisionArgs.data.reasoning).toBe('provider unavailable');
      expect(failureDecisionArgs.data.tier).toBe(ConfidenceTier.AUTO);
    });
  });

  describe('queueForApproval', () => {
    it('writes ApprovalQueue then QUEUED_FOR_APPROVAL AgentDecision, no OUTBOUND message', async () => {
      await service.queueForApproval({
        ...BASE,
        classifyResult: CLASSIFY_RESULT,
        draftResult: DRAFT_RESULT,
      });

      expect(prisma.message.create).not.toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const approvalArgs = prisma.approvalQueue.create.mock.calls[0]?.[0] as {
        data: { draftReply: string; status: string };
      };
      expect(approvalArgs.data.draftReply).toBe(DRAFT_RESULT.draft);
      // ApprovalStatus.PENDING is the default in schema, no need to pass it
      expect(approvalArgs.data.draftReply).toBeTruthy();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const decisionArgs = prisma.agentDecision.create.mock.calls[0]?.[0] as {
        data: { actionTaken: string; tier: string };
      };
      expect(decisionArgs.data.actionTaken).toBe('QUEUED_FOR_APPROVAL');
      expect(decisionArgs.data.tier).toBe(ConfidenceTier.APPROVE);
    });
  });

  describe('escalate', () => {
    it('writes ESCALATED AgentDecision preserving classify data', async () => {
      await service.escalate({
        coachId: 'coach-1',
        messageId: 'msg-1',
        reason: 'Sensitive keyword detected',
        actionTaken: 'ESCALATED',
        classifyResult: CLASSIFY_RESULT,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const decisionArgs = prisma.agentDecision.create.mock.calls[0]?.[0] as {
        data: {
          actionTaken: string;
          tier: string;
          intent: string;
          confidence: number;
          llmModel: string;
          tokensIn: number;
        };
      };
      expect(decisionArgs.data.actionTaken).toBe('ESCALATED');
      expect(decisionArgs.data.tier).toBe(ConfidenceTier.ESCALATE);
      expect(decisionArgs.data.intent).toBe('BOOK');
      expect(decisionArgs.data.confidence).toBe(0.92);
      expect(decisionArgs.data.llmModel).toBe('claude-haiku-4-5-20251001');
      expect(decisionArgs.data.tokensIn).toBe(35);
    });

    it('writes CLASSIFY_FAILED with AMBIGUOUS intent and null classify fields when no classifyResult', async () => {
      await service.escalate({
        coachId: 'coach-1',
        messageId: 'msg-1',
        reason: 'Error: llm down',
        actionTaken: 'CLASSIFY_FAILED',
        classifyResult: undefined,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const decisionArgs = prisma.agentDecision.create.mock.calls[0]?.[0] as {
        data: {
          actionTaken: string;
          intent: string;
          confidence: number;
          llmModel: unknown;
          tokensIn: unknown;
        };
      };
      expect(decisionArgs.data.actionTaken).toBe('CLASSIFY_FAILED');
      expect(decisionArgs.data.intent).toBe('AMBIGUOUS');
      expect(decisionArgs.data.confidence).toBe(0);
      expect(decisionArgs.data.llmModel).toBeNull();
      expect(decisionArgs.data.tokensIn).toBeNull();
    });
  });
});
