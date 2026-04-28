import { Injectable } from '@nestjs/common';
import {
  type Kid,
  type Message,
  type Parent,
  type Session,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';

export type AvailableSlot = {
  startAt: Date;
  endAt: Date;
  label: string;
};

export type AgentContext = {
  parent: Parent;
  kids: Kid[];
  recentMessages: Message[];
  upcomingSessions: Array<Session & { kid: Pick<Kid, 'id' | 'name'> }>;
  availableSlots: AvailableSlot[];
  timezone: string;
};

function formatSlotLabel(startAt: Date, endAt: Date, timezone: string): string {
  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(startAt);

  const startTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(startAt);

  const endTime = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(endAt);

  return `${datePart}, ${startTime}–${endTime}`;
}

@Injectable()
export class LoadContextState {
  constructor(private readonly prisma: PrismaService) {}

  async loadContext(parentId: string, coachId: string): Promise<AgentContext> {
    const coach = await this.prisma.coach.findUniqueOrThrow({
      where: { id: coachId },
      select: { timezone: true },
    });

    const parent = await this.prisma.parent.findFirstOrThrow({
      where: { id: parentId, coachId },
      include: {
        kids: { orderBy: { createdAt: 'asc' } },
      },
    });

    const recentMessages = await this.prisma.message.findMany({
      where: { parentId, coachId },
      orderBy: { receivedAt: 'desc' },
      take: 10,
    });

    const upcomingSessions = await this.prisma.session.findMany({
      where: {
        coachId,
        kid: { parentId },
        scheduledAt: { gte: new Date() },
      },
      include: { kid: { select: { id: true, name: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 3,
    });

    const availableSlots = await this.loadAvailableSlots(
      coachId,
      coach.timezone,
    );

    return {
      parent,
      kids: parent.kids,
      recentMessages,
      upcomingSessions,
      availableSlots,
      timezone: coach.timezone,
    };
  }

  private async loadAvailableSlots(
    coachId: string,
    timezone: string,
  ): Promise<AvailableSlot[]> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const [availabilityRows, conflictingSessions] = await Promise.all([
      this.prisma.availability.findMany({
        where: {
          coachId,
          isBlocked: false,
          startAt: { gte: now, lt: windowEnd },
        },
        orderBy: { startAt: 'asc' },
        take: 10,
      }),
      this.prisma.session.findMany({
        where: {
          coachId,
          status: { in: ['CONFIRMED', 'PROPOSED'] },
          scheduledAt: { lt: windowEnd },
        },
        select: { scheduledAt: true, durationMinutes: true },
      }),
    ]);

    return availabilityRows
      .filter((slot) => {
        return !conflictingSessions.some((session) => {
          const sessionEnd = new Date(
            session.scheduledAt.getTime() + session.durationMinutes * 60 * 1000,
          );
          return session.scheduledAt < slot.endAt && sessionEnd > slot.startAt;
        });
      })
      .map((slot) => ({
        startAt: slot.startAt,
        endAt: slot.endAt,
        label: formatSlotLabel(slot.startAt, slot.endAt, timezone),
      }));
  }
}
