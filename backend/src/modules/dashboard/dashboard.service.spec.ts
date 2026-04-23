import { Test } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma.service';
import { ApprovalStatus } from '@prisma/client';

function makePrismaMock() {
  return {
    agentDecision: { findMany: jest.fn(), count: jest.fn() },
    approvalQueue: { findMany: jest.fn(), update: jest.fn() },
    session: { findMany: jest.fn() },
    parent: { findMany: jest.fn() },
    coach: { findUnique: jest.fn(), update: jest.fn() },
  };
}

async function makeService(prisma: ReturnType<typeof makePrismaMock>) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      DashboardService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return moduleRef.get(DashboardService);
}

describe('DashboardService.sendApproval', () => {
  it('updates approval status to APPROVED with resolvedBy=coach', async () => {
    const prisma = makePrismaMock();
    prisma.approvalQueue.update.mockResolvedValue({});
    const service = await makeService(prisma);

    await service.sendApproval('coach-1', 'approval-1');

    expect(prisma.approvalQueue.update).toHaveBeenCalledWith({
      where: { id: 'approval-1', coachId: 'coach-1' },
      data: expect.objectContaining({
        status: ApprovalStatus.APPROVED,
        resolvedBy: 'coach',
        resolvedAt: expect.any(Date),
      }),
    });
  });
});

describe('DashboardService.dismissApproval', () => {
  it('updates approval status to REJECTED with resolvedBy=coach', async () => {
    const prisma = makePrismaMock();
    prisma.approvalQueue.update.mockResolvedValue({});
    const service = await makeService(prisma);

    await service.dismissApproval('coach-1', 'approval-1');

    expect(prisma.approvalQueue.update).toHaveBeenCalledWith({
      where: { id: 'approval-1', coachId: 'coach-1' },
      data: expect.objectContaining({
        status: ApprovalStatus.REJECTED,
        resolvedBy: 'coach',
        resolvedAt: expect.any(Date),
      }),
    });
  });
});

describe('DashboardService.getHome', () => {
  it('maps escalated decisions into fires with parent/kid/preview', async () => {
    const prisma = makePrismaMock();
    const now = new Date();
    const autoHandledStubs = [
      { id: 'ah1', actionTaken: 'AUTO_SENT', intent: 'PAYMENT', createdAt: now, reasoning: null, message: { parent: { name: 'P1', kids: [{ name: 'K1' }] } } },
      { id: 'ah2', actionTaken: 'AUTO_SENT', intent: 'RESCHEDULE', createdAt: now, reasoning: null, message: { parent: { name: 'P2', kids: [{ name: 'K2' }] } } },
      { id: 'ah3', actionTaken: 'AUTO_SENT', intent: 'GENERAL', createdAt: now, reasoning: null, message: { parent: { name: 'P3', kids: [{ name: 'K3' }] } } },
    ];
    prisma.agentDecision.findMany
      .mockResolvedValueOnce([
        {
          id: 'd1',
          actionTaken: 'ESCALATED',
          intent: 'PAYMENT',
          createdAt: now,
          message: {
            content: 'I see two charges this month.',
            parent: { name: 'Amara Osei', kids: [{ name: 'Kofi' }] },
          },
        },
      ])
      .mockResolvedValueOnce(autoHandledStubs); // autoHandled call
    prisma.approvalQueue.findMany.mockResolvedValue([]);
    prisma.session.findMany.mockResolvedValue([]);

    const service = await makeService(prisma);
    const result = await service.getHome('coach-1');

    expect(result.fires).toHaveLength(1);
    expect(result.fires[0]).toMatchObject({
      id: 'd1',
      parent: 'Amara Osei',
      kid: 'Kofi',
      intent: 'PAYMENT',
      preview: 'I see two charges this month.',
    });
    expect(result.stats.handledCount).toBe(3);
  });

  it('maps pending approvals with draft and confidence', async () => {
    const prisma = makePrismaMock();
    const now = new Date();
    prisma.agentDecision.findMany
      .mockResolvedValueOnce([]) // fires
      .mockResolvedValueOnce([]); // autoHandled
    prisma.approvalQueue.findMany.mockResolvedValue([
      {
        id: 'a1',
        draftReply: 'Hi — happy to reschedule.',
        createdAt: now,
        message: {
          content: 'Can we move Thursday?',
          parent: { name: 'Jess Tanaka', kids: [{ name: 'Rhea' }] },
          agentDecisions: [
            {
              intent: 'RESCHEDULE',
              confidence: 0.91,
              reasoning: 'known parent, slot available',
            },
          ],
        },
      },
    ]);
    prisma.session.findMany.mockResolvedValue([]);

    const service = await makeService(prisma);
    const result = await service.getHome('coach-1');

    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]).toMatchObject({
      id: 'a1',
      parent: 'Jess Tanaka',
      kid: 'Rhea',
      intent: 'RESCHEDULE',
      draft: 'Hi — happy to reschedule.',
      confidence: 0.91,
    });
  });
});

describe('DashboardService.getSettings', () => {
  it('returns autonomyEnabled from Coach record', async () => {
    const prisma = makePrismaMock();
    prisma.coach.findUnique.mockResolvedValue({
      id: 'c1',
      name: 'Robin Ade',
      phone: '+14155550147',
      timezone: 'America/Los_Angeles',
      stripeAccountId: null,
      autonomyEnabled: true,
    });

    const service = await makeService(prisma);
    const result = await service.getSettings('c1');

    expect(result.autonomyEnabled).toBe(true);
    expect(result.name).toBe('Robin Ade');
  });
});
