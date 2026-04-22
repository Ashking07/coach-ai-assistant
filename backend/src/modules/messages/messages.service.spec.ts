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
    parent: { findUnique: jest.fn(), upsert: jest.fn() },
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

  it('known phone (createdAt !== updatedAt) does not log UNKNOWN_PARENT_CREATED', async () => {
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

  it('DB commit happens before enqueue (enqueue failure leaves row committed)', async () => {
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
