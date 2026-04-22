import { Test } from '@nestjs/testing';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../prisma.service';
import { TEST_JOB_QUEUE } from '../../bullmq.module';
import type { ParentMessage } from '@coach/shared';

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
    parent: { upsert: jest.fn() },
    message: { findUnique: jest.fn(), create: jest.fn() },
  };
}

function makeQueueMock() {
  return { add: jest.fn() };
}

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
      ],
    }).compile();
    service = moduleRef.get(MessagesService);
    logSpy = jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
  });

  it('fresh phone creates unverified Parent, logs UNKNOWN_PARENT_CREATED, enqueues', async () => {
    const now = new Date('2026-04-21T12:00:00Z');
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      coachId: 'demo-coach',
      phone: '+15555550001',
      isVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue({ id: 'msg-1' });
    queue.add.mockResolvedValue({ id: 'job-1' });

    const result = await service.ingest(baseMsg);

    expect(prisma.parent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { coachId_phone: { coachId: 'demo-coach', phone: '+15555550001' } },
        create: expect.objectContaining({ isVerified: false, name: 'Jane' }),
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
    expect(queue.add).toHaveBeenCalledWith('MESSAGE_INGESTED', { messageId: 'msg-1' });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'UNKNOWN_PARENT_CREATED', parentId: 'parent-1' }),
      'MessagesService',
    );
    expect(result).toEqual({
      messageId: 'msg-1',
      duplicate: false,
      enqueued: true,
      jobId: 'job-1',
    });
  });

  it('known phone (createdAt !== updatedAt) does not log UNKNOWN_PARENT_CREATED', async () => {
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-04-01'),
    });
    prisma.message.findUnique.mockResolvedValue(null);
    prisma.message.create.mockResolvedValue({ id: 'msg-2' });
    queue.add.mockResolvedValue({ id: 'job-2' });

    await service.ingest(baseMsg);

    const unknownCalls = logSpy.mock.calls.filter(
      (c) => c[0]?.event === 'UNKNOWN_PARENT_CREATED',
    );
    expect(unknownCalls).toHaveLength(0);
  });

  it('duplicate (channel, providerMessageId) returns early without enqueue', async () => {
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-04-01'),
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

  it('DB commit happens before enqueue (enqueue failure leaves row committed)', async () => {
    prisma.parent.upsert.mockResolvedValue({
      id: 'parent-1',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-04-01'),
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
