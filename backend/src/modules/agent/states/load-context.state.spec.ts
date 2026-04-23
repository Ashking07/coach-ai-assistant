import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../prisma.service';
import { LoadContextState } from './load-context.state';

describe('LoadContextState', () => {
  function makeBasePrisma() {
    return {
      coach: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'coach-1',
          timezone: 'America/Los_Angeles',
        }),
      },
      parent: {
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'parent-1',
          coachId: 'coach-1',
          kids: [{ id: 'kid-1', name: 'Priya' }],
        }),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([{ id: 'msg-1' }]),
      },
      session: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      availability: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  }

  it('loads parent, kids, recent messages, upcoming sessions, and availableSlots', async () => {
    const prisma = makeBasePrisma();

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoadContextState,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    const state = moduleRef.get<LoadContextState>(LoadContextState);
    const ctx = await state.loadContext('parent-1', 'coach-1');

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const parentQuery = prisma.parent.findFirstOrThrow.mock.calls[0]?.[0] as {
      where: { id: string; coachId: string };
    };
    expect(parentQuery.where).toEqual({ id: 'parent-1', coachId: 'coach-1' });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const messagesQuery = prisma.message.findMany.mock.calls[0]?.[0] as {
      take: number;
    };
    expect(messagesQuery.take).toBe(10);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const sessionsQuery = prisma.session.findMany.mock.calls[0]?.[0] as {
      take: number;
    };
    expect(sessionsQuery.take).toBe(3);

    expect(ctx.availableSlots).toEqual([]);
  });

  it('excludes slots where a CONFIRMED session overlaps [slot.startAt, slot.endAt)', async () => {
    const prisma = makeBasePrisma();

    const slotStart = new Date('2026-04-24T17:00:00Z');
    const slotEnd = new Date('2026-04-24T18:00:00Z');

    prisma.availability.findMany.mockResolvedValue([
      { id: 'avail-1', startAt: slotStart, endAt: slotEnd },
    ]);

    prisma.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        scheduledAt: slotStart,
        durationMinutes: 60,
        status: 'CONFIRMED',
      },
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoadContextState,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    const ctx = await moduleRef
      .get<LoadContextState>(LoadContextState)
      .loadContext('parent-1', 'coach-1');

    expect(ctx.availableSlots).toHaveLength(0);
  });

  it('keeps slots with no session overlap', async () => {
    const prisma = makeBasePrisma();

    const slotStart = new Date('2026-04-24T17:00:00Z');
    const slotEnd = new Date('2026-04-24T18:00:00Z');

    prisma.availability.findMany.mockResolvedValue([
      { id: 'avail-1', startAt: slotStart, endAt: slotEnd },
    ]);

    // Session ends one millisecond before slot starts — no overlap
    const sessionStart = new Date(slotStart.getTime() - 60 * 60 * 1000);
    prisma.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        scheduledAt: sessionStart,
        durationMinutes: 60,
        status: 'CONFIRMED',
      },
    ]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        LoadContextState,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    const ctx = await moduleRef
      .get<LoadContextState>(LoadContextState)
      .loadContext('parent-1', 'coach-1');

    expect(ctx.availableSlots).toHaveLength(1);
    // slotStart = 2026-04-24T17:00:00Z = 10:00 AM LA time
    expect(ctx.availableSlots[0].label).toMatch(/Friday/);
    expect(ctx.availableSlots[0].label).toMatch(/AM/);
  });
});
