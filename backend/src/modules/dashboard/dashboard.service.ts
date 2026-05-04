import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApprovalStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../../prisma.service';
import { ChannelSenderRegistry } from '../agent/channels/channel-sender.registry';
import { LLM_CLIENT } from '../agent/llm/llm.constants';
import type { LlmClient } from '../agent/llm/llm.client';
import { OBS_EMITTER, type ObsEmitterPort } from '../observability/observability.constants';
import { traceRun, traceStep } from '../observability/trace-step';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayBoundsForTZ(tz: string): { start: Date; end: Date } {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  // Compute the UTC offset for this timezone right now (handles DST automatically)
  const utcMs = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const tzMs = new Date(now.toLocaleString('en-US', { timeZone: tz })).getTime();
  const offsetMs = utcMs - tzMs;
  return {
    start: new Date(new Date(`${dateStr}T00:00:00`).getTime() + offsetMs),
    end: new Date(new Date(`${dateStr}T23:59:59.999`).getTime() + offsetMs),
  };
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

export interface FireDto {
  id: string;
  parent: string;
  kid: string;
  reason: string;
  ago: string;
  preview: string;
  intent: string;
}

export interface ApprovalDto {
  id: string;
  parent: string;
  kid: string;
  intent: string;
  incoming: string;
  draft: string;
  confidence: number;
  ago: string;
  reason: string;
}

export interface SessionDto {
  id: string;
  kid: string;
  time: string;
  duration: string;
  note: string;
  paid: boolean;
}

export interface AutoHandledDto {
  id: string;
  parent: string;
  kid: string;
  intent: string;
  summary: string;
  time: string;
}

export interface HomeResponseDto {
  fires: FireDto[];
  approvals: ApprovalDto[];
  sessions: SessionDto[];
  autoHandled: AutoHandledDto[];
  stats: { firesCount: number; handledCount: number };
  coach: { timezone: string };
}

export interface AuditEntryDto {
  id: string;
  ts: string;
  parent: string;
  kid: string;
  intent: string;
  tier: string;
  action: 'AUTO_SENT' | 'QUEUED_FOR_APPROVAL' | 'ESCALATED' | 'FAILED';
  model: string;
  tokens: number;
  latencyMs: number;
  incoming: string;
  draft: string;
  trace: { step: string; verdict: string }[];
}

export interface ParentEntryDto {
  id: string;
  name: string;
  kids: string[];
  lastMessage: string;
}

export interface SettingsDto {
  id: string;
  name: string;
  phone: string;
  timezone: string;
  stripeAccountId: string | null;
  autonomyEnabled: boolean;
  agentPaused: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHrs = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  return remMins > 0 ? `${diffHrs}h ${remMins}m` : `${diffHrs}h`;
}

function toHHMM(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function firstKid(kids: { name: string }[]): string {
  return kids[0]?.name ?? '—';
}

function buildTrace(d: {
  intent: string;
  confidence: number | null;
  tier: string | null;
  actionTaken: string;
  reasoning: string | null;
}): { step: string; verdict: string }[] {
  const trace: { step: string; verdict: string }[] = [];
  const conf = d.confidence != null ? ` · ${d.confidence.toFixed(2)}` : '';
  trace.push({ step: 'classify', verdict: `${d.intent}${conf}` });
  if (d.tier) trace.push({ step: 'confidence', verdict: d.tier });
  if (d.reasoning) {
    trace.push({ step: 'reasoning', verdict: d.reasoning.slice(0, 100) });
  }
  trace.push({ step: 'outcome', verdict: d.actionTaken });
  return trace;
}

function toAuditAction(
  actionTaken: string,
): 'AUTO_SENT' | 'QUEUED_FOR_APPROVAL' | 'ESCALATED' | 'FAILED' {
  if (actionTaken === 'AUTO_SENT') return 'AUTO_SENT';
  if (actionTaken === 'QUEUED_FOR_APPROVAL') return 'QUEUED_FOR_APPROVAL';
  if (actionTaken === 'ESCALATED') return 'ESCALATED';
  return 'FAILED';
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channelSenderRegistry: ChannelSenderRegistry,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    @Inject(OBS_EMITTER) private readonly obs: ObsEmitterPort,
  ) {}

  async getHome(coachId: string): Promise<HomeResponseDto> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const coach = await this.prisma.coach.findUniqueOrThrow({
      where: { id: coachId },
      select: { timezone: true },
    });
    const { start, end } = todayBoundsForTZ(coach.timezone);

    const [
      fireDecisions,
      pendingApprovals,
      todaySessions,
      autoHandledDecisions,
    ] = await Promise.all([
      this.prisma.agentDecision.findMany({
        where: {
          coachId,
          actionTaken: {
            in: ['ESCALATED', 'CLASSIFY_FAILED', 'DRAFT_FAILED', 'SEND_FAILED'],
          },
          createdAt: { gte: since24h },
          resolvedAt: null,
        },
        include: {
          message: { include: { parent: { include: { kids: { take: 1 } } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.approvalQueue.findMany({
        where: { coachId, status: 'PENDING' },
        include: {
          message: {
            include: {
              parent: { include: { kids: { take: 1 } } },
              agentDecisions: { orderBy: { createdAt: 'desc' }, take: 1 },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      (() => {
        return this.prisma.session.findMany({
          where: {
            coachId,
            scheduledAt: { gte: start, lte: end },
            status: { not: 'CANCELLED' },
          },
          include: { kid: true },
          orderBy: { scheduledAt: 'asc' },
        });
      })(),
      this.prisma.agentDecision.findMany({
        where: {
          coachId,
          actionTaken: 'AUTO_SENT',
          createdAt: { gte: since24h },
        },
        include: {
          message: { include: { parent: { include: { kids: { take: 1 } } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const handledCount = autoHandledDecisions.length;

    const fires: FireDto[] = fireDecisions.map((d) => ({
      id: d.id,
      parent: d.message.parent.name,
      kid: firstKid(d.message.parent.kids),
      reason: d.actionTaken,
      ago: toAgo(d.createdAt),
      preview: d.message.content.slice(0, 120),
      intent: d.intent,
    }));

    const approvals: ApprovalDto[] = pendingApprovals.map((a) => {
      const decision = a.message.agentDecisions[0];
      return {
        id: a.id,
        parent: a.message.parent.name,
        kid: firstKid(a.message.parent.kids),
        intent: decision?.intent ?? 'AMBIGUOUS',
        incoming: a.message.content,
        draft: a.draftReply,
        confidence: decision?.confidence ?? 0,
        ago: toAgo(a.createdAt),
        reason: decision?.reasoning?.slice(0, 120) ?? '',
      };
    });

    const sessions: SessionDto[] = todaySessions.map((s) => ({
      id: s.id,
      kid: s.kid.name,
      time: toHHMM(s.scheduledAt),
      duration: `${s.durationMinutes}m`,
      note: s.coachNotes,
      paid: s.paid,
    }));

    const autoHandled: AutoHandledDto[] = autoHandledDecisions.map((d) => ({
      id: d.id,
      parent: d.message.parent.name,
      kid: firstKid(d.message.parent.kids),
      intent: d.intent,
      summary: d.reasoning?.split('.')[0] ?? d.actionTaken,
      time: toHHMM(d.createdAt),
    }));

    return {
      fires,
      approvals,
      sessions,
      autoHandled,
      stats: { firesCount: fires.length, handledCount },
      coach: { timezone: coach.timezone },
    };
  }

  async getAudit(coachId: string): Promise<AuditEntryDto[]> {
    const decisions = await this.prisma.agentDecision.findMany({
      where: { coachId },
      include: {
        message: {
          include: {
            parent: { include: { kids: { take: 1 } } },
            approvals: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return decisions.map((d) => ({
      id: d.id,
      ts: d.createdAt.toISOString().replace('T', ' ').slice(0, 19),
      parent: d.message.parent.name,
      kid: firstKid(d.message.parent.kids),
      intent: d.intent,
      tier: d.tier ?? 'AUTO',
      action: toAuditAction(d.actionTaken),
      model: d.llmModel ?? '—',
      tokens: (d.tokensIn ?? 0) + (d.tokensOut ?? 0),
      latencyMs: d.latencyMs ?? 0,
      incoming: d.message.content,
      draft: d.message.approvals[0]?.draftReply ?? d.reasoning ?? '(auto-sent)',
      trace: buildTrace(d),
    }));
  }

  async getParents(coachId: string): Promise<ParentEntryDto[]> {
    const parents = await this.prisma.parent.findMany({
      where: { coachId },
      include: {
        kids: true,
        messages: { orderBy: { receivedAt: 'desc' }, take: 1 },
      },
      orderBy: { name: 'asc' },
    });

    return parents.map((p) => ({
      id: p.id,
      name: p.name,
      kids: p.kids.map((k) => `${k.name} (${k.age})`),
      lastMessage: p.messages[0]
        ? toAgo(p.messages[0].receivedAt)
        : 'No messages',
    }));
  }

  async getSettings(coachId: string): Promise<SettingsDto> {
    const coach = await this.prisma.coach.findUnique({
      where: { id: coachId },
    });
    if (!coach) throw new NotFoundException('Coach not found');
    return {
      id: coach.id,
      name: coach.name,
      phone: coach.phone,
      timezone: coach.timezone,
      stripeAccountId: coach.stripeAccountId,
      autonomyEnabled: coach.autonomyEnabled,
      agentPaused: coach.agentPaused,
    };
  }

  async updateSettings(
    coachId: string,
    body: { autonomyEnabled: boolean },
  ): Promise<SettingsDto> {
    const coach = await this.prisma.coach.update({
      where: { id: coachId },
      data: { autonomyEnabled: body.autonomyEnabled },
    });
    return {
      id: coach.id,
      name: coach.name,
      phone: coach.phone,
      timezone: coach.timezone,
      stripeAccountId: coach.stripeAccountId,
      autonomyEnabled: coach.autonomyEnabled,
      agentPaused: coach.agentPaused,
    };
  }

  async pauseAgent(coachId: string): Promise<SettingsDto> {
    const coach = await this.prisma.coach.update({
      where: { id: coachId },
      data: { agentPaused: true },
    });
    this.logger.log({ event: 'AGENT_PAUSED', coachId });
    return {
      id: coach.id,
      name: coach.name,
      phone: coach.phone,
      timezone: coach.timezone,
      stripeAccountId: coach.stripeAccountId,
      autonomyEnabled: coach.autonomyEnabled,
      agentPaused: coach.agentPaused,
    };
  }

  async resumeAgent(coachId: string): Promise<SettingsDto> {
    const coach = await this.prisma.coach.update({
      where: { id: coachId },
      data: { agentPaused: false },
    });
    this.logger.log({ event: 'AGENT_RESUMED', coachId });
    return {
      id: coach.id,
      name: coach.name,
      phone: coach.phone,
      timezone: coach.timezone,
      stripeAccountId: coach.stripeAccountId,
      autonomyEnabled: coach.autonomyEnabled,
      agentPaused: coach.agentPaused,
    };
  }

  async sendApproval(coachId: string, approvalId: string, draft?: string): Promise<void> {
    await traceRun(
      this.obs,
      { runbook: 'coach.approve_pending', input: { coachId, approvalId } },
      async (ctx) => {
        const updated = await traceStep(
          this.obs,
          ctx,
          'mark_approved',
          'db.approvalQueue.update',
          { approvalId, hasDraft: Boolean(draft) },
          () =>
            this.prisma.approvalQueue.update({
              where: { id: approvalId, coachId },
              data: {
                ...(draft ? { draftReply: draft } : {}),
                status: ApprovalStatus.APPROVED,
                resolvedAt: new Date(),
                resolvedBy: 'coach',
              },
              include: {
                message: { select: { id: true, parentId: true, channel: true } },
              },
            }),
        );

        const content = updated.draftReply;
        const { parentId, channel } = updated.message;
        const cancelSessionId = updated.cancelSessionId;
        const outboundId = randomUUID();

        await traceStep(
          this.obs,
          ctx,
          'persist_outbound',
          'db.message.create',
          { parentId, channel },
          () =>
            this.prisma.message.create({
              data: {
                coachId,
                parentId,
                direction: 'OUTBOUND',
                channel,
                providerMessageId: outboundId,
                content,
                receivedAt: new Date(),
              },
            }),
        );

        await traceStep(
          this.obs,
          ctx,
          'send_via_channel',
          'channel.send',
          { parentId, channel },
          async () => {
            const sender = this.channelSenderRegistry.get(channel);
            const result = await sender.send({
              coachId,
              messageId: outboundId,
              parentId,
              content,
            });
            this.logger.log({
              event: result.ok ? 'APPROVAL_SENT' : 'APPROVAL_SEND_FAILED',
              approvalId,
              parentId,
              error: result.ok ? undefined : result.error,
            });
            return result;
          },
        );

        if (cancelSessionId) {
          await traceStep(
            this.obs,
            ctx,
            'cancel_session',
            'db.session.update',
            { sessionId: cancelSessionId },
            async () => {
              const session = await this.prisma.session.findFirst({
                where: {
                  id: cancelSessionId,
                  coachId,
                  kid: { parentId },
                },
                select: { id: true, status: true },
              });
              if (!session) {
                this.logger.warn({
                  event: 'APPROVAL_CANCEL_SESSION_NOT_OWNED',
                  approvalId,
                  sessionId: cancelSessionId,
                  parentId,
                });
                return;
              }
              if (session.status === 'CANCELLED') {
                return;
              }
              await this.prisma.session.update({
                where: { id: cancelSessionId },
                data: { status: 'CANCELLED' },
              });
              this.logger.log({
                event: 'SESSION_CANCELLED_BY_APPROVAL',
                approvalId,
                sessionId: cancelSessionId,
                parentId,
              });
            },
          );
        }
      },
    );
  }

  async dismissApproval(coachId: string, approvalId: string): Promise<void> {
    await traceRun(
      this.obs,
      { runbook: 'coach.dismiss_pending', input: { coachId, approvalId } },
      async (ctx) => {
        await traceStep(
          this.obs,
          ctx,
          'mark_rejected',
          'db.approvalQueue.update',
          { approvalId },
          () =>
            this.prisma.approvalQueue.update({
              where: { id: approvalId, coachId },
              data: {
                status: ApprovalStatus.REJECTED,
                resolvedAt: new Date(),
                resolvedBy: 'coach',
              },
            }),
        );
      },
    );
  }

  async dismissFire(coachId: string, decisionId: string): Promise<void> {
    await this.prisma.agentDecision.update({
      where: { id: decisionId, coachId },
      data: { resolvedAt: new Date(), resolvedBy: 'coach' },
    });
  }

  async cancelSession(coachId: string, sessionId: string): Promise<void> {
    await traceRun(
      this.obs,
      { runbook: 'coach.cancel_session', input: { coachId, sessionId } },
      async (ctx) => {
        const session = await traceStep(
          this.obs,
          ctx,
          'lookup_session',
          'db.session.findFirst',
          { sessionId },
          () => this.prisma.session.findFirst({ where: { id: sessionId, coachId } }),
        );
        if (!session) {
          throw new NotFoundException('Session not found');
        }

        await traceStep(
          this.obs,
          ctx,
          'cancel_session',
          'db.session.update',
          { sessionId },
          () =>
            this.prisma.session.update({
              where: { id: sessionId },
              data: { status: 'CANCELLED' },
            }),
        );

        this.logger.log({ event: 'SESSION_CANCELLED', coachId, sessionId });
      },
    );
  }

  async sendDraftedReply(
    coachId: string,
    body: { parentName: string; body: string },
  ): Promise<void> {
    await traceRun(
      this.obs,
      {
        runbook: 'coach.send_drafted_reply',
        input: { coachId, parentName: body.parentName },
      },
      async (ctx) => {
        const parent = await traceStep(
          this.obs,
          ctx,
          'lookup_parent',
          'db.parent.findFirst',
          { parentName: body.parentName },
          async () =>
            (await this.prisma.parent.findFirst({
              where: { coachId, name: body.parentName },
            })) ??
            (await this.prisma.parent.findFirst({
              where: {
                coachId,
                name: { contains: body.parentName, mode: 'insensitive' },
              },
            })),
        );

        if (!parent) {
          throw new NotFoundException(`Parent '${body.parentName}' not found`);
        }

        await traceStep(
          this.obs,
          ctx,
          'send_via_channel',
          'agent.outbound.send',
          { channel: parent.preferredChannel, parentId: parent.id },
          async () => {
            const outboundId = randomUUID();
            await this.prisma.message.create({
              data: {
                coachId,
                parentId: parent.id,
                direction: 'OUTBOUND',
                channel: parent.preferredChannel,
                providerMessageId: outboundId,
                content: body.body,
                receivedAt: new Date(),
              },
            });

            const sender = this.channelSenderRegistry.get(parent.preferredChannel);
            const result = await sender.send({
              coachId,
              messageId: outboundId,
              parentId: parent.id,
              content: body.body,
            });

            this.logger.log({
              event: result.ok ? 'VOICE_DRAFT_REPLY_SENT' : 'VOICE_DRAFT_REPLY_FAILED',
              parentId: parent.id,
              error: result.ok ? undefined : result.error,
            });
          },
        );
      },
    );
  }

  async getWeekSessions(coachId: string, weekStart?: string) {
    const monday = weekStart ? new Date(weekStart) : (() => {
      const now = new Date();
      const d = new Date(now);
      d.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      d.setHours(0, 0, 0, 0);
      return d;
    })();
    const weekEnd = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

    const sessions = await this.prisma.session.findMany({
      where: {
        coachId,
        scheduledAt: { gte: monday, lt: weekEnd },
        status: { in: ['CONFIRMED', 'PROPOSED'] },
      },
      include: { kid: { select: { name: true } } },
      orderBy: { scheduledAt: 'asc' },
    });

    return sessions.map((s) => ({
      id: s.id,
      kidName: s.kid.name,
      scheduledAt: s.scheduledAt.toISOString(),
      durationMinutes: s.durationMinutes,
      paid: s.paid,
    }));
  }

  async getAvailability(coachId: string, weekStart?: string) {
    const monday = weekStart ? new Date(weekStart) : (() => {
      const now = new Date();
      const d = new Date(now);
      d.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      d.setHours(0, 0, 0, 0);
      return d;
    })();
    const weekEnd = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);

    return this.prisma.availability.findMany({
      where: { coachId, startAt: { gte: monday, lt: weekEnd } },
      orderBy: { startAt: 'asc' },
      select: { id: true, startAt: true, endAt: true, isBlocked: true, reason: true },
    });
  }

  async addAvailability(coachId: string, startAt: string, endAt: string, isBlocked = false) {
    const row = await this.prisma.availability.create({
      data: { coachId, startAt: new Date(startAt), endAt: new Date(endAt), isBlocked },
      select: { id: true, startAt: true, endAt: true, isBlocked: true, reason: true },
    });

    // Fire-and-forget broadcast — don't let send failures block the response
    this.broadcastAvailabilityToParents(coachId, row.startAt, row.endAt).catch(
      (err) => this.logger.error({ event: 'BROADCAST_AVAILABILITY_FAILED', err }),
    );

    return row;
  }

  private async broadcastAvailabilityToParents(
    coachId: string,
    startAt: Date,
    endAt: Date,
  ): Promise<void> {
    const [coach, parents] = await Promise.all([
      this.prisma.coach.findUniqueOrThrow({ where: { id: coachId }, select: { name: true, timezone: true } }),
      this.prisma.parent.findMany({
        where: { coachId, isVerified: true },
        select: { id: true, name: true, phone: true, preferredChannel: true },
      }),
    ]);

    if (!parents.length) return;

    const slotLabel = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: coach.timezone,
    }).format(startAt);

    for (const parent of parents) {
      const firstName = parent.name.split(' ')[0];
      const body =
        `Hi ${firstName}! ${coach.name} just opened up a session slot: ${slotLabel}. ` +
        `Reply "Book" to grab it, or just ask any questions!`;

      try {
        const sender = this.channelSenderRegistry.get(parent.preferredChannel);
        const outboundId = randomUUID();
        await this.prisma.message.create({
          data: {
            coachId,
            parentId: parent.id,
            direction: 'OUTBOUND',
            channel: parent.preferredChannel,
            providerMessageId: outboundId,
            content: body,
            receivedAt: new Date(),
          },
        });
        const result = await sender.send({
          coachId,
          messageId: outboundId,
          parentId: parent.id,
          content: body,
        });
        this.logger.log({
          event: result.ok ? 'AVAILABILITY_BROADCAST_SENT' : 'AVAILABILITY_BROADCAST_SEND_FAILED',
          parentId: parent.id,
          channel: parent.preferredChannel,
          error: result.ok ? undefined : result.error,
        });
      } catch (err) {
        this.logger.error({ event: 'AVAILABILITY_BROADCAST_ERROR', parentId: parent.id, err });
      }
    }
  }

  async removeAvailability(coachId: string, id: string): Promise<void> {
    const slot = await this.prisma.availability.findFirst({
      where: { id, coachId },
      select: { startAt: true, endAt: true },
    });
    await this.prisma.availability.deleteMany({ where: { id, coachId } });
    if (slot) {
      this.broadcastAvailabilityRemoved(coachId, slot.startAt).catch(
        (err) => this.logger.error({ event: 'BROADCAST_REMOVAL_FAILED', err }),
      );
    }
  }

  private async broadcastAvailabilityRemoved(coachId: string, startAt: Date): Promise<void> {
    const [coach, parents] = await Promise.all([
      this.prisma.coach.findUniqueOrThrow({ where: { id: coachId }, select: { name: true, timezone: true } }),
      this.prisma.parent.findMany({
        where: { coachId, isVerified: true },
        select: { id: true, name: true, preferredChannel: true },
      }),
    ]);
    if (!parents.length) return;
    const slotLabel = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
      timeZone: coach.timezone,
    }).format(startAt);
    for (const parent of parents) {
      const body = `Hi ${parent.name.split(' ')[0]}! Just a heads-up — ${coach.name} has removed the slot on ${slotLabel}. Feel free to ask about other available times!`;
      try {
        const sender = this.channelSenderRegistry.get(parent.preferredChannel);
        const outboundId = randomUUID();
        await this.prisma.message.create({
          data: {
            coachId, parentId: parent.id, direction: 'OUTBOUND',
            channel: parent.preferredChannel, providerMessageId: outboundId,
            content: body, receivedAt: new Date(),
          },
        });
        await sender.send({ coachId, messageId: outboundId, parentId: parent.id, content: body });
      } catch (err) {
        this.logger.error({ event: 'REMOVAL_BROADCAST_ERROR', parentId: parent.id, err });
      }
    }
  }

  async scheduleSession(
    coachId: string,
    kidId: string,
    startAtIso: string,
    durationMinutes = 60,
  ): Promise<{ id: string }> {
    const scheduledAt = new Date(startAtIso);
    if (isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid ISO datetime');
    }
    if (scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future');
    }

    const durationMs = durationMinutes * 60 * 1000;
    const slotWindowStart = new Date(scheduledAt.getTime() - 2 * 60 * 1000);
    const slotWindowEnd = new Date(scheduledAt.getTime() + 2 * 60 * 1000);
    const overlapWindowStart = new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000);
    const overlapWindowEnd = new Date(scheduledAt.getTime() + durationMs);

    const created = await this.prisma.$transaction(async (tx) => {
      const kid = await tx.kid.findFirst({ where: { id: kidId, coachId } });
      if (!kid) throw new NotFoundException('Kid not found');

      const candidates = await tx.session.findMany({
        where: {
          coachId,
          status: { not: 'CANCELLED' },
          scheduledAt: { lt: overlapWindowEnd, gte: overlapWindowStart },
        },
        select: { id: true, scheduledAt: true, durationMinutes: true },
      });

      const hasOverlap = candidates.some((s) => {
        const endAt = new Date(s.scheduledAt.getTime() + s.durationMinutes * 60 * 1000);
        return s.scheduledAt < overlapWindowEnd && endAt > scheduledAt;
      });
      if (hasOverlap) {
        throw new ConflictException('Session overlaps existing session');
      }

      const session = await tx.session.create({
        data: {
          coachId,
          kidId,
          scheduledAt,
          durationMinutes,
          status: 'CONFIRMED',
        },
      });

      await tx.availability.deleteMany({
        where: {
          coachId,
          isBlocked: false,
          startAt: { gte: slotWindowStart, lte: slotWindowEnd },
        },
      });

      return session;
    });

    // TODO: If we ever add notifications for manual scheduling, add them here.
    this.logger.log({ event: 'SESSION_SCHEDULED', coachId, kidId, startAtIso, durationMinutes });
    return { id: created.id };
  }

  async getKids(coachId: string): Promise<{ id: string; name: string; parentName: string }[]> {
    const kids = await this.prisma.kid.findMany({
      where: { coachId },
      include: { parent: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return kids.map((k) => ({ id: k.id, name: k.name, parentName: k.parent?.name ?? 'Unknown parent' }));
  }

  async createSessionRecap(
    coachId: string,
    sessionId: string,
    transcript: string,
  ): Promise<{ approvalId: string }> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, coachId },
      include: { kid: { include: { parent: true } } },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const schemas = z.object({
      recap: z.string().transform((s) => s.slice(0, 480)),
    });

    const sessionDate = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(session.scheduledAt);

    const systemPrompt = `
You are drafting a text message FROM the coach TO the parent after a training session.
Tone: warm, personal, encouraging, conversational — like a text from a trusted coach.
Rules:
- Write in first person as the coach ("Great session today...", "Just wanted to share...").
- Address the parent by their first name at the start.
- 2–3 sentences maximum.
- Focus on the child's highlights and progress.
- End on a positive, forward-looking note.
- Never mention internal notes, pricing, or anything not suitable to send directly.
`.trim();

    const parentFirstName = session.kid.parent.name.split(' ')[0];
    const userPrompt = [
      `Session date: ${sessionDate}`,
      `Child's name: ${session.kid.name}`,
      `Duration: ${session.durationMinutes} minutes`,
      `Coach's voice note: ${transcript}`,
      `Write the text message from the coach to ${parentFirstName} (parent of ${session.kid.name}).`,
      `Respond with JSON: { "recap": "..." }`,
    ].join('\n');

    const result = await this.llm.classify(transcript, {
      schema: schemas,
      systemPrompt,
      userPrompt,
      model: 'claude-sonnet-4-6',
      maxTokens: 300,
      temperature: 0.3,
    });

    // Create outbound message — capture the DB id (cuid), not providerMessageId
    const message = await this.prisma.message.create({
      data: {
        coachId,
        parentId: session.kid.parentId,
        direction: 'OUTBOUND',
        channel: session.kid.parent.preferredChannel,
        providerMessageId: randomUUID(),
        content: result.parsed.recap,
        receivedAt: new Date(),
      },
    });

    // Queue for coach approval — messageId is the FK to Message.id
    const approval = await this.prisma.approvalQueue.create({
      data: {
        coachId,
        messageId: message.id,
        draftReply: result.parsed.recap,
        status: ApprovalStatus.PENDING,
      },
    });

    this.logger.log({
      event: 'SESSION_RECAP_DRAFTED',
      coachId,
      sessionId,
      approvalId: approval.id,
    });

    return { approvalId: approval.id };
  }
}
