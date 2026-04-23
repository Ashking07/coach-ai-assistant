import { Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async getHome(coachId: string): Promise<HomeResponseDto> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [fireDecisions, pendingApprovals, todaySessions, autoHandledDecisions, handledCount] =
      await Promise.all([
        this.prisma.agentDecision.findMany({
          where: {
            coachId,
            actionTaken: { notIn: ['AUTO_SENT', 'QUEUED_FOR_APPROVAL'] },
            createdAt: { gte: since24h },
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
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          const end = new Date();
          end.setHours(23, 59, 59, 999);
          return this.prisma.session.findMany({
            where: { coachId, scheduledAt: { gte: start, lte: end }, status: { not: 'CANCELLED' } },
            include: { kid: true },
            orderBy: { scheduledAt: 'asc' },
          });
        })(),
        this.prisma.agentDecision.findMany({
          where: { coachId, actionTaken: 'AUTO_SENT', createdAt: { gte: since24h } },
          include: { message: { include: { parent: { include: { kids: { take: 1 } } } } } },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.agentDecision.count({
          where: { coachId, actionTaken: 'AUTO_SENT', createdAt: { gte: since24h } },
        }),
      ]);

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
      draft:
        d.message.approvals[0]?.draftReply ??
        d.reasoning ??
        '(auto-sent)',
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
    const coach = await this.prisma.coach.findUnique({ where: { id: coachId } });
    if (!coach) throw new NotFoundException('Coach not found');
    return {
      id: coach.id,
      name: coach.name,
      phone: coach.phone,
      timezone: coach.timezone,
      stripeAccountId: coach.stripeAccountId,
      autonomyEnabled: coach.autonomyEnabled,
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
    };
  }

  async sendApproval(coachId: string, approvalId: string): Promise<void> {
    await this.prisma.approvalQueue.update({
      where: { id: approvalId, coachId },
      data: {
        status: ApprovalStatus.APPROVED,
        resolvedAt: new Date(),
        resolvedBy: 'coach',
      },
    });
  }

  async dismissApproval(coachId: string, approvalId: string): Promise<void> {
    await this.prisma.approvalQueue.update({
      where: { id: approvalId, coachId },
      data: {
        status: ApprovalStatus.REJECTED,
        resolvedAt: new Date(),
        resolvedBy: 'coach',
      },
    });
  }
}
