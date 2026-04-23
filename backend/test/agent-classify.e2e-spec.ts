/* eslint-disable @typescript-eslint/no-unsafe-argument */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { MessagesService } from '../src/modules/messages/messages.service';
import { LLM_CLIENT } from '../src/modules/agent/llm/llm.constants';
import { startWorker } from '../src/worker';

jest.setTimeout(30000);

const TOKEN = process.env.INTERNAL_INGEST_TOKEN!;
const COACH_ID = 'demo-coach';
const REAL_ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.startsWith('sk-ant-')
  ? process.env.ANTHROPIC_API_KEY
  : undefined;

interface InboundBody {
  messageId: string;
  duplicate: boolean;
}

async function waitForDecision(
  prisma: PrismaService,
  messageId: string,
  timeoutMs = 8000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await prisma.agentDecision.findFirst({ where: { messageId } });
    if (d) return d;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(
    `No AgentDecision appeared for message ${messageId} within ${timeoutMs}ms`,
  );
}

async function cleanup(
  prisma: PrismaService,
  phones: string[],
  providerIds: string[],
) {
  await prisma.agentDecision.deleteMany({
    where: { message: { providerMessageId: { in: providerIds } } },
  });
  await prisma.approvalQueue.deleteMany({
    where: { message: { providerMessageId: { in: providerIds } } },
  });
  // OUTBOUND messages share the same coachId, clean them up by coachId+direction
  await prisma.message.deleteMany({
    where: { coachId: COACH_ID, direction: 'OUTBOUND' },
  });
  await prisma.message.deleteMany({
    where: { providerMessageId: { in: providerIds } },
  });
  await prisma.parent.deleteMany({
    where: { coachId: COACH_ID, phone: { in: phones } },
  });
}

type LlmClassifyOpts = { systemPrompt: string };

// Mock LLM_CLIENT: distinguish classify vs draft calls via systemPrompt
function makeMockLlmClient() {
  return {
    classify: jest
      .fn()
      .mockImplementation((_input: string, opts: LlmClassifyOpts) => {
        const isClassify = opts.systemPrompt.includes('intent classifier');
        return Promise.resolve(
          isClassify
            ? {
                parsed: {
                  intent: 'BOOK',
                  confidence: 0.98,
                  reasoning: 'Deterministic book fixture',
                },
                usage: { tokensIn: 27, tokensOut: 8 },
                model: 'claude-haiku-4-5-20251001',
                latencyMs: 10,
              }
            : {
                parsed: { reply: 'Hi! Thursday 9:00 AM works — confirmed!' },
                usage: { tokensIn: 40, tokensOut: 15 },
                model: 'claude-sonnet-4-6',
                latencyMs: 20,
              },
        );
      }),
  };
}

describe('agent classify e2e (deterministic mock)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let messagesService: MessagesService;
  let workerHandle: ReturnType<typeof startWorker>;

  beforeAll(async () => {
    if (!TOKEN) throw new Error('INTERNAL_INGEST_TOKEN must be set for e2e');
    if (!process.env.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    }
    process.env.BULLMQ_QUEUE_NAME = 'coach-agent-classify-mock-e2e';

    const llmMock = makeMockLlmClient();
    const moduleBuilder: TestingModuleBuilder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_CLIENT)
      .useValue(llmMock);

    const moduleRef = await moduleBuilder.compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    messagesService = app.get(MessagesService);
    workerHandle = startWorker(messagesService);
  });

  afterAll(async () => {
    await workerHandle.close();
    await app.close();
    delete process.env.BULLMQ_QUEUE_NAME;
  });

  it('classifies BOOK + escalates unknown sender end-to-end without network', async () => {
    const phone = '+15550000100';
    const providerId = `e2e-${randomUUID()}`;

    try {
      const res = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send({
          coachId: COACH_ID,
          channel: 'WEB_CHAT',
          fromPhone: phone,
          fromName: 'Mock Parent',
          content: 'Can we book Priya this Thursday?',
          providerMessageId: providerId,
        });

      const body = res.body as InboundBody;
      expect(res.status).toBe(200);
      expect(body.duplicate).toBe(false);

      // PolicyGate fires (unknown sender → isVerified=false), so decision is ESCALATED
      const decision = await waitForDecision(prisma, body.messageId);
      expect(decision.intent).toBe('BOOK');
      expect(decision.confidence ?? 0).toBeGreaterThanOrEqual(0.9);
      expect(decision.actionTaken).toBe('ESCALATED');
      expect(decision.tier).toBe('ESCALATE');
    } finally {
      await cleanup(prisma, [phone], [providerId]);
    }
  });

  it('auto-sends when parent is verified and availability slot exists', async () => {
    const phone = '+15550000102';
    const providerId = `e2e-${randomUUID()}`;

    // Create availability slot for next Monday-ish (3 days ahead) at 9:00
    const slotStart = new Date();
    slotStart.setDate(slotStart.getDate() + 3);
    slotStart.setHours(9, 0, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(10, 0, 0, 0);
    const slotId = `avail-e2e-${randomUUID()}`;

    try {
      // Pre-create verified parent so PolicyGate passes
      await prisma.parent.upsert({
        where: { coachId_phone: { coachId: COACH_ID, phone } },
        create: {
          coachId: COACH_ID,
          phone,
          name: 'Verified Auto Parent',
          preferredChannel: 'WEB_CHAT',
          isVerified: true,
        },
        update: { isVerified: true },
      });

      await prisma.availability.create({
        data: {
          id: slotId,
          coachId: COACH_ID,
          startAt: slotStart,
          endAt: slotEnd,
          isBlocked: false,
          reason: '',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send({
          coachId: COACH_ID,
          channel: 'WEB_CHAT',
          fromPhone: phone,
          fromName: 'Verified Auto Parent',
          content: 'Can we book Priya this Thursday?',
          providerMessageId: providerId,
        });

      const body = res.body as InboundBody;
      expect(res.status).toBe(200);
      expect(body.duplicate).toBe(false);

      const decision = await waitForDecision(prisma, body.messageId);
      expect(decision.intent).toBe('BOOK');
      expect(decision.actionTaken).toBe('AUTO_SENT');
      expect(decision.tier).toBe('AUTO');
      expect(decision.tokensIn).toBeGreaterThan(0);
    } finally {
      await prisma.availability.deleteMany({ where: { id: slotId } });
      await cleanup(prisma, [phone], [providerId]);
    }
  });
});

const realLlmDescribe = REAL_ANTHROPIC_KEY ? describe : describe.skip;

realLlmDescribe('agent classify e2e (real llm)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let messagesService: MessagesService;
  let workerHandle: ReturnType<typeof startWorker>;

  beforeAll(async () => {
    if (!TOKEN) throw new Error('INTERNAL_INGEST_TOKEN must be set for e2e');
    process.env.BULLMQ_QUEUE_NAME = 'coach-agent-classify-real-e2e';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    messagesService = app.get(MessagesService);
    workerHandle = startWorker(messagesService);
  });

  afterAll(async () => {
    await workerHandle.close();
    await app.close();
    delete process.env.BULLMQ_QUEUE_NAME;
  });

  it('end-to-end: verified parent + slot → AUTO_SENT with real LLM', async () => {
    const phone = '+15550000101';
    const providerId = `e2e-${randomUUID()}`;

    const slotStart = new Date();
    slotStart.setDate(slotStart.getDate() + 3);
    slotStart.setHours(9, 0, 0, 0);
    const slotEnd = new Date(slotStart);
    slotEnd.setHours(10, 0, 0, 0);
    const slotId = `avail-e2e-real-${randomUUID()}`;

    try {
      await prisma.parent.upsert({
        where: { coachId_phone: { coachId: COACH_ID, phone } },
        create: {
          coachId: COACH_ID,
          phone,
          name: 'Verified Parent',
          preferredChannel: 'SMS',
          isVerified: true,
        },
        update: { isVerified: true },
      });

      await prisma.availability.create({
        data: {
          id: slotId,
          coachId: COACH_ID,
          startAt: slotStart,
          endAt: slotEnd,
          isBlocked: false,
          reason: '',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send({
          coachId: COACH_ID,
          channel: 'SMS',
          fromPhone: phone,
          fromName: 'Verified Parent',
          content: 'Can we book Priya Thursday at 9am?',
          providerMessageId: providerId,
        });

      const body = res.body as InboundBody;
      expect(res.status).toBe(200);
      expect(body.duplicate).toBe(false);

      const decision = await waitForDecision(prisma, body.messageId, 15000);
      expect(decision.intent).toBe('BOOK');
      expect(decision.confidence ?? 0).toBeGreaterThanOrEqual(0.6);
      // May be AUTO_SENT or QUEUED_FOR_APPROVAL depending on confidence and draft validation
      expect(['AUTO_SENT', 'QUEUED_FOR_APPROVAL']).toContain(
        decision.actionTaken,
      );
      expect(decision.llmModel).toBeTruthy();
      expect(decision.tokensIn).toBeTruthy();
    } finally {
      await prisma.availability.deleteMany({ where: { id: slotId } });
      await cleanup(prisma, [phone], [providerId]);
    }
  });
});
