/* eslint-disable @typescript-eslint/no-unsafe-argument */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { MessagesService } from '../src/modules/messages/messages.service';
import { startWorker } from '../src/worker';

jest.setTimeout(30000);

interface InboundBody {
  messageId: string;
  duplicate: boolean;
}

const TOKEN = process.env.INTERNAL_INGEST_TOKEN!;
const COACH_ID = 'demo-coach';

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

describe('POST /api/messages/inbound (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let messagesService: MessagesService;
  let workerHandle: ReturnType<typeof startWorker>;

  beforeAll(async () => {
    if (!TOKEN) throw new Error('INTERNAL_INGEST_TOKEN must be set for e2e');
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
  });

  async function cleanup(phones: string[], providerIds: string[]) {
    await prisma.agentDecision.deleteMany({
      where: { message: { providerMessageId: { in: providerIds } } },
    });
    await prisma.message.deleteMany({
      where: { providerMessageId: { in: providerIds } },
    });
    await prisma.parent.deleteMany({
      where: { coachId: COACH_ID, phone: { in: phones } },
    });
  }

  it('1. happy path: 200, job runs, placeholder AgentDecision written', async () => {
    const phone = '+15550000001';
    const providerId = `e2e-${randomUUID()}`;
    try {
      const res = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send({
          coachId: COACH_ID,
          channel: 'WEB_CHAT',
          fromPhone: phone,
          fromName: 'E2E Test',
          content: 'hello from e2e',
          providerMessageId: providerId,
        });
      const body1 = res.body as InboundBody;
      expect(res.status).toBe(200);
      expect(body1).toMatchObject({ duplicate: false });
      expect(body1.messageId).toEqual(expect.any(String));

      const decision = await waitForDecision(prisma, body1.messageId);
      expect(decision.intent).toBe('NOT_PROCESSED');
      expect(decision.actionTaken).toBe('INGESTED');
      expect(decision.confidence).toBeNull();
      expect(decision.tier).toBeNull();
      expect(decision.reasoning).toBeNull();
      expect(decision.llmModel).toBeNull();
      expect(decision.tokensIn).toBeNull();
      expect(decision.tokensOut).toBeNull();
      expect(decision.latencyMs).toBeNull();

      const msg = await prisma.message.findUnique({
        where: { id: body1.messageId },
      });
      expect(msg?.processedAt).toBeInstanceOf(Date);
      expect(Date.now() - msg!.processedAt!.getTime()).toBeLessThan(10000);
    } finally {
      await cleanup([phone], [providerId]);
    }
  });

  it('2. auth: bad token → 401, nothing written', async () => {
    const phone = '+15550000002';
    const providerId = `e2e-${randomUUID()}`;
    const res = await request(app.getHttpServer())
      .post('/api/messages/inbound')
      .set('x-internal-token', 'bogus')
      .send({
        coachId: COACH_ID,
        channel: 'WEB_CHAT',
        fromPhone: phone,
        content: 'should not land',
        providerMessageId: providerId,
      });
    expect(res.status).toBe(401);
    const msg = await prisma.message.findUnique({
      where: {
        channel_providerMessageId: {
          channel: 'WEB_CHAT',
          providerMessageId: providerId,
        },
      },
    });
    expect(msg).toBeNull();
    const parent = await prisma.parent.findUnique({
      where: { coachId_phone: { coachId: COACH_ID, phone } },
    });
    expect(parent).toBeNull();
  });

  it('3. idempotency: same payload twice → same messageId, exactly one AgentDecision', async () => {
    const phone = '+15550000003';
    const providerId = `e2e-${randomUUID()}`;
    try {
      const body = {
        coachId: COACH_ID,
        channel: 'WEB_CHAT',
        fromPhone: phone,
        content: 'idem',
        providerMessageId: providerId,
      };
      const a = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send(body);
      const bodyA = a.body as InboundBody;
      expect(a.status).toBe(200);
      expect(bodyA.duplicate).toBe(false);

      await waitForDecision(prisma, bodyA.messageId);

      const b = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send(body);
      const bodyB = b.body as InboundBody;
      expect(b.status).toBe(200);
      expect(bodyB).toEqual({ messageId: bodyA.messageId, duplicate: true });

      const decisions = await prisma.agentDecision.findMany({
        where: { messageId: bodyA.messageId },
      });
      expect(decisions).toHaveLength(1);
    } finally {
      await cleanup([phone], [providerId]);
    }
  });

  it('4. unknown parent: creates Parent with isVerified=false and "Unknown" name if no fromName', async () => {
    const phone = '+15550000004';
    const providerId = `e2e-${randomUUID()}`;
    try {
      const res = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send({
          coachId: COACH_ID,
          channel: 'SMS',
          fromPhone: phone,
          content: 'stranger danger',
          providerMessageId: providerId,
        });
      expect(res.status).toBe(200);

      const parent = await prisma.parent.findUnique({
        where: { coachId_phone: { coachId: COACH_ID, phone } },
      });
      expect(parent).toBeTruthy();
      expect(parent!.isVerified).toBe(false);
      expect(parent!.name).toBe(`Unknown (${phone})`);
    } finally {
      await cleanup([phone], [providerId]);
    }
  });

  it('5. recovery sweep: orphan Message → recoverOrphanedMessages re-enqueues → AgentDecision appears', async () => {
    const phone = '+15550000005';
    const providerId = `e2e-${randomUUID()}`;
    try {
      // Intentionally bypass ingest() to create an orphan (no AgentDecision yet).
      const parent = await prisma.parent.create({
        data: {
          coachId: COACH_ID,
          phone,
          name: 'Orphan Parent',
          preferredChannel: 'SMS',
          isVerified: false,
        },
      });
      const orphan = await prisma.message.create({
        data: {
          coachId: COACH_ID,
          parentId: parent.id,
          direction: 'INBOUND',
          channel: 'SMS',
          providerMessageId: providerId,
          content: 'orphaned pre-boot',
          receivedAt: new Date(),
        },
      });

      // Close the current worker, run recovery, restart worker to process the re-enqueued job.
      await workerHandle.close();
      const recovered = await messagesService.recoverOrphanedMessages();
      expect(recovered).toBeGreaterThanOrEqual(1);
      workerHandle = startWorker(messagesService);

      const decision = await waitForDecision(prisma, orphan.id);
      expect(decision.intent).toBe('NOT_PROCESSED');
      expect(decision.actionTaken).toBe('INGESTED');
    } finally {
      await cleanup([phone], [providerId]);
    }
  });
});
