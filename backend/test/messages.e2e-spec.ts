/* eslint-disable @typescript-eslint/no-unsafe-argument */
import 'dotenv/config';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { LLM_CLIENT } from '../src/modules/agent/llm/llm.constants';

jest.setTimeout(30000);

const TOKEN = process.env.INTERNAL_INGEST_TOKEN!;
const COACH_ID = 'demo-coach';

if (!process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
}

type LlmClassifyOpts = { systemPrompt: string };

// Deterministic mock: distinguish classify vs draft calls via systemPrompt
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
                  confidence: 0.95,
                  reasoning: 'Booking request',
                },
                usage: { tokensIn: 30, tokensOut: 10 },
                model: 'claude-haiku-4-5-20251001',
                latencyMs: 10,
              }
            : {
                parsed: {
                  reply: 'Hi! Thursday 9:00 AM works — confirmed!',
                },
                usage: { tokensIn: 40, tokensOut: 15 },
                model: 'claude-sonnet-4-6',
                latencyMs: 20,
              },
        );
      }),
  };
}

describe('POST /api/messages/inbound (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    if (!TOKEN) throw new Error('INTERNAL_INGEST_TOKEN must be set for e2e');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_CLIENT)
      .useValue(makeMockLlmClient())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function cleanup(phones: string[], providerIds: string[]) {
    await prisma.agentDecision.deleteMany({
      where: { message: { providerMessageId: { in: providerIds } } },
    });
    await prisma.approvalQueue.deleteMany({
      where: { message: { providerMessageId: { in: providerIds } } },
    });
    await prisma.message.deleteMany({
      where: { providerMessageId: { in: providerIds } },
    });
    await prisma.parent.deleteMany({
      where: { coachId: COACH_ID, phone: { in: phones } },
    });
  }

  it('1. rejects missing token with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/messages/inbound')
      .send({
        coachId: COACH_ID,
        channel: 'WEB_CHAT',
        content: 'hi',
        fromPhone: '+15551110001',
        providerMessageId: 'e2e-auth-1',
        receivedAt: new Date().toISOString(),
      });
    expect(res.status).toBe(401);
  });

  it('2. accepts valid payload and returns messageId + duplicate=false', async () => {
    const phone = '+15551110002';
    const providerId = 'e2e-inbound-2';
    try {
      const res = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send({
          coachId: COACH_ID,
          channel: 'WEB_CHAT',
          content: 'Can we book Priya on Thursday?',
          fromPhone: phone,
          providerMessageId: providerId,
          receivedAt: new Date().toISOString(),
        });
      const body2 = res.body as { messageId: string; duplicate: boolean };
      expect(res.status).toBe(200);
      expect(body2.messageId).toBeTruthy();
      expect(body2.duplicate).toBe(false);
    } finally {
      await cleanup([phone], [providerId]);
    }
  });

  it('3. duplicate providerMessageId returns duplicate=true', async () => {
    const phone = '+15551110003';
    const providerId = 'e2e-inbound-3';
    const payload = {
      coachId: COACH_ID,
      channel: 'WEB_CHAT' as const,
      content: 'Book please',
      fromPhone: phone,
      providerMessageId: providerId,
      receivedAt: new Date().toISOString(),
    };
    try {
      const first = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send(payload);
      const firstBody = first.body as { messageId: string; duplicate: boolean };
      expect(first.status).toBe(200);
      expect(firstBody.duplicate).toBe(false);

      const second = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send(payload);
      const secondBody = second.body as {
        messageId: string;
        duplicate: boolean;
      };
      expect(second.status).toBe(200);
      expect(secondBody.duplicate).toBe(true);
      expect(secondBody.messageId).toBe(firstBody.messageId);
    } finally {
      await cleanup([phone], [providerId]);
    }
  });

  it('4. unknown parent: creates Parent with isVerified=false', async () => {
    const phone = '+15551110004';
    const providerId = 'e2e-inbound-4';
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
          receivedAt: new Date().toISOString(),
        });
      expect(res.status).toBe(200);
      const parent = await prisma.parent.findUnique({
        where: { coachId_phone: { coachId: COACH_ID, phone } },
      });
      expect(parent).toBeTruthy();
      expect(parent!.isVerified).toBe(false);
    } finally {
      await cleanup([phone], [providerId]);
    }
  });
});
