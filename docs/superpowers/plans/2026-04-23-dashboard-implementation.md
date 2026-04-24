# Coach Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Figma Make coach dashboard design into the React/Vite/Tailwind frontend and connect it to new NestJS dashboard API endpoints backed by the existing Postgres schema.

**Architecture:** A new `DashboardModule` (controller + service) is added to the NestJS backend, exposing 7 read/write endpoints guarded by a static `x-dashboard-token` header. The frontend replaces its placeholder `App.tsx` with the full 4-screen Figma Make design, using TanStack Query hooks that call those endpoints.

**Tech Stack:** NestJS 11, Prisma 7, React 19, TanStack Query 5, Tailwind 4, TypeScript, Zod, lucide-react

---

## File Map

### Backend (new/modified)
| File | Action | Purpose |
|------|--------|---------|
| `backend/prisma/schema.prisma` | Modify | Add `autonomyEnabled Boolean @default(true)` to Coach |
| `backend/src/common/env.validation.ts` | Modify | Add `DASHBOARD_TOKEN`, `COACH_ID` to Zod schema |
| `backend/src/modules/dashboard/dashboard.module.ts` | Create | NestJS module declaration |
| `backend/src/modules/dashboard/dashboard.service.ts` | Create | All Prisma queries + DTO mapping |
| `backend/src/modules/dashboard/dashboard.service.spec.ts` | Create | Unit tests for service |
| `backend/src/modules/dashboard/dashboard.controller.ts` | Create | Token guard + route handlers |
| `backend/src/app.module.ts` | Modify | Register DashboardModule |
| `backend/.env` | Modify | Add DASHBOARD_TOKEN, COACH_ID |

### Frontend (new/modified)
| File | Action | Purpose |
|------|--------|---------|
| `frontend/index.html` | Modify | Add Google Fonts (Fraunces, Geist Mono, Inter Tight) |
| `frontend/src/index.css` | Modify | Strip to just `@import "tailwindcss"` |
| `frontend/src/tokens.ts` | Create | Color tokens + dark/light CSS variable maps |
| `frontend/src/lib/api.ts` | Create | Typed fetch wrapper + all API types |
| `frontend/src/components/avatar.tsx` | Create | KidAvatar — initials with deterministic color |
| `frontend/src/components/badges.tsx` | Create | IntentBadge, TierBadge |
| `frontend/src/components/side-nav.tsx` | Create | Desktop left sidebar |
| `frontend/src/components/bottom-tab-bar.tsx` | Create | Mobile bottom nav |
| `frontend/src/components/cards.tsx` | Create | FireCard, ApprovalCard, SessionCard |
| `frontend/src/components/approval-detail.tsx` | Create | Full-screen approval detail overlay |
| `frontend/src/components/screens/home.tsx` | Create | Home screen |
| `frontend/src/components/screens/audit.tsx` | Create | Audit log screen |
| `frontend/src/components/screens/parents.tsx` | Create | Parents directory screen |
| `frontend/src/components/screens/settings.tsx` | Create | Settings screen |
| `frontend/src/App.tsx` | Modify | Theme, tab routing, layout shell |
| `frontend/.env.local` | Create | VITE_API_URL, VITE_DASHBOARD_TOKEN |

---

## Task 1: Prisma Migration — autonomyEnabled on Coach

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/common/env.validation.ts`
- Modify: `backend/.env`

- [ ] **Step 1: Add `autonomyEnabled` to Coach model**

In `backend/prisma/schema.prisma`, find the `Coach` model and add the field after `createdAt`:

```prisma
model Coach {
  id               String   @id @default(cuid())
  name             String
  phone            String
  timezone         String   @default("America/Los_Angeles")
  stripeAccountId  String?
  autonomyEnabled  Boolean  @default(true)
  createdAt        DateTime @default(now())

  parents          Parent[]
  kids             Kid[]
  sessions         Session[]
  availability     Availability[]
  messages         Message[]
  agentDecisions   AgentDecision[]
  approvals        ApprovalQueue[]
}
```

- [ ] **Step 2: Run the migration**

```bash
cd backend && pnpm prisma migrate dev --name add-coach-autonomy-enabled
```

Expected: `Your database is now in sync with your schema.` and a new file in `prisma/migrations/`.

- [ ] **Step 3: Add DASHBOARD_TOKEN and COACH_ID to env validation**

Replace the `EnvSchema` in `backend/src/common/env.validation.ts`:

```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ANTHROPIC_API_KEY: z.string().min(1),
  REDIS_URL: z.string().url().optional(),
  INTERNAL_INGEST_TOKEN: z
    .string()
    .min(16, 'INTERNAL_INGEST_TOKEN must be >=16 chars'),
  DASHBOARD_TOKEN: z
    .string()
    .min(16, 'DASHBOARD_TOKEN must be >=16 chars'),
  COACH_ID: z.string().min(1, 'COACH_ID must be set'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().optional(),
  CORS_ORIGIN: z.string().optional(),
  BULLMQ_QUEUE_NAME: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Add vars to backend/.env**

Append to `backend/.env`:

```
DASHBOARD_TOKEN="dev-dashboard-token-local-1234"
COACH_ID=""
```

Leave `COACH_ID` empty for now — it gets filled in Task 4 after seeding/finding the coach.

- [ ] **Step 5: Commit**

```bash
cd backend && git add prisma/schema.prisma prisma/migrations/ src/common/env.validation.ts .env
git commit -m "feat(dashboard): add autonomyEnabled to Coach + env vars for dashboard API"
```

---

## Task 2: DashboardService (TDD)

**Files:**
- Create: `backend/src/modules/dashboard/dashboard.service.ts`
- Create: `backend/src/modules/dashboard/dashboard.service.spec.ts`

- [ ] **Step 1: Create the spec file**

Create `backend/src/modules/dashboard/dashboard.service.spec.ts`:

```typescript
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
      .mockResolvedValueOnce([]); // autoHandled call
    prisma.approvalQueue.findMany.mockResolvedValue([]);
    prisma.session.findMany.mockResolvedValue([]);
    prisma.agentDecision.count.mockResolvedValue(3);

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
    prisma.agentDecision.count.mockResolvedValue(0);

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
```

- [ ] **Step 2: Run tests — expect them to FAIL (module missing)**

```bash
cd backend && pnpm test -- dashboard.service
```

Expected: FAIL — `Cannot find module './dashboard.service'`

- [ ] **Step 3: Create the service implementation**

Create `backend/src/modules/dashboard/dashboard.service.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests — expect them to PASS**

```bash
cd backend && pnpm test -- dashboard.service
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/dashboard/dashboard.service.ts backend/src/modules/dashboard/dashboard.service.spec.ts
git commit -m "feat(dashboard): DashboardService with home/audit/parents/settings/approval endpoints"
```

---

## Task 3: DashboardController + Module + AppModule Registration

**Files:**
- Create: `backend/src/modules/dashboard/dashboard.controller.ts`
- Create: `backend/src/modules/dashboard/dashboard.module.ts`
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Create the controller**

Create `backend/src/modules/dashboard/dashboard.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { DashboardService } from './dashboard.service';

@Controller('api/dashboard')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly config: ConfigService,
  ) {}

  private guard(token: string | undefined): string {
    const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }
    return this.config.getOrThrow<string>('COACH_ID');
  }

  @Get('home')
  getHome(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getHome(this.guard(token));
  }

  @Get('audit')
  getAudit(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getAudit(this.guard(token));
  }

  @Get('parents')
  getParents(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getParents(this.guard(token));
  }

  @Get('settings')
  getSettings(@Headers('x-dashboard-token') token: string | undefined) {
    return this.dashboardService.getSettings(this.guard(token));
  }

  @Patch('settings')
  updateSettings(
    @Headers('x-dashboard-token') token: string | undefined,
    @Body() body: { autonomyEnabled: boolean },
  ) {
    return this.dashboardService.updateSettings(this.guard(token), body);
  }

  @Post('approvals/:id/send')
  sendApproval(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.sendApproval(this.guard(token), id);
  }

  @Post('approvals/:id/dismiss')
  dismissApproval(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ) {
    return this.dashboardService.dismissApproval(this.guard(token), id);
  }
}
```

- [ ] **Step 2: Create the module**

Create `backend/src/modules/dashboard/dashboard.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 3: Register DashboardModule in AppModule**

Replace `backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullMqModule } from './bullmq.module';
import { PrismaModule } from './prisma.module';
import { AgentModule } from './modules/agent/agent.module';
import { MessagesModule } from './modules/messages/messages.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { validateEnv } from './common/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
    }),
    BullMqModule,
    PrismaModule,
    AgentModule,
    MessagesModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: 'ENV_VALIDATION',
      useFactory: () => validateEnv(process.env),
    },
    AppService,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run all backend tests to verify nothing broken**

```bash
cd backend && pnpm test
```

Expected: All existing tests pass, no new failures.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/dashboard/ backend/src/app.module.ts
git commit -m "feat(dashboard): DashboardController + DashboardModule wired into AppModule"
```

---

## Task 4: Seed Coach + Backend Smoke Test

**Files:**
- Modify: `backend/.env`

- [ ] **Step 1: Find or create a coach in the DB**

Run Prisma Studio to inspect the DB:

```bash
cd backend && pnpm prisma studio
```

Open `http://localhost:5555` in your browser. Go to the `Coach` table.

**If a coach exists:** copy its `id` value.

**If no coach exists:** click "Add record" and fill in:
- `name`: Robin Ade
- `phone`: +14155550147
- `timezone`: America/Los_Angeles
- `autonomyEnabled`: true

Then copy the generated `id`.

- [ ] **Step 2: Set COACH_ID in backend/.env**

Replace the empty `COACH_ID=""` line in `backend/.env` with the actual ID:

```
COACH_ID="<paste-id-here>"
```

- [ ] **Step 3: Start the backend**

```bash
cd backend && pnpm start:dev
```

Wait for `NestJS application is listening on port 3002`.

- [ ] **Step 4: Smoke test the home endpoint**

```bash
curl -s -H "x-dashboard-token: dev-dashboard-token-local-1234" \
  http://localhost:3002/api/dashboard/home | python3 -m json.tool | head -40
```

Expected: JSON with `fires`, `approvals`, `sessions`, `autoHandled`, `stats` keys (values may be empty arrays if DB is fresh).

- [ ] **Step 5: Smoke test auth rejection**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/api/dashboard/home
```

Expected: `401`

- [ ] **Step 6: Smoke test settings**

```bash
curl -s -H "x-dashboard-token: dev-dashboard-token-local-1234" \
  http://localhost:3002/api/dashboard/settings | python3 -m json.tool
```

Expected: JSON with coach name, phone, autonomyEnabled, etc.

---

## Task 5: Install lucide-react + tokens.ts + Google Fonts

**Files:**
- Modify: `frontend/package.json` (via pnpm add)
- Modify: `frontend/index.html`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/tokens.ts`

- [ ] **Step 1: Install lucide-react**

```bash
cd frontend && pnpm add lucide-react
```

Expected: `lucide-react` added to dependencies in `package.json`.

- [ ] **Step 2: Add Google Fonts to index.html**

Replace `frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Coach Assistant</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,400&family=Geist+Mono:wght@400;500&family=Inter+Tight:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Strip index.css to just the Tailwind import**

Replace `frontend/src/index.css` entirely:

```css
@import "tailwindcss";

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#root {
  width: 100%;
  min-height: 100dvh;
}
```

- [ ] **Step 4: Create tokens.ts**

Create `frontend/src/tokens.ts`:

```typescript
export const T = {
  moss: '#7A8B6E',
  sunrise: '#C47B3E',
  amber: '#D4A840',
  terracotta: '#B85C3A',
} as const;

export const darkVars = {
  '--bg': '#0E0F0C',
  '--panel': 'rgba(23, 24, 20, 0.5)',
  '--panel-solid': 'rgba(14, 15, 12, 0.92)',
  '--surface-sub': 'rgba(247, 243, 236, 0.04)',
  '--text': '#F7F3EC',
  '--muted': '#A8A49B',
  '--hairline': '#2A2B27',
} as const;

export const lightVars = {
  '--bg': '#F7F3EC',
  '--panel': '#FFFFFF',
  '--panel-solid': 'rgba(247, 243, 236, 0.94)',
  '--surface-sub': '#F1EBDF',
  '--text': '#0E0F0C',
  '--muted': '#6B6860',
  '--hairline': '#E6E1D7',
} as const;

export type ThemeVars = typeof darkVars;
```

- [ ] **Step 5: Commit**

```bash
# Run from repo root
git add frontend/package.json pnpm-lock.yaml frontend/index.html frontend/src/index.css frontend/src/tokens.ts
git commit -m "feat(frontend): lucide-react, Google Fonts, tokens, reset index.css"
```

---

## Task 6: Frontend API Client (lib/api.ts)

**Files:**
- Create: `frontend/src/lib/api.ts`

- [ ] **Step 1: Create the typed API client**

Create `frontend/src/lib/api.ts`:

```typescript
// ─── Types ───────────────────────────────────────────────────────────────────

export interface Fire {
  id: string;
  parent: string;
  kid: string;
  reason: string;
  ago: string;
  preview: string;
  intent: string;
}

export interface Approval {
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

export interface DashboardSession {
  id: string;
  kid: string;
  time: string;
  duration: string;
  note: string;
  paid: boolean;
}

export interface AutoHandled {
  id: string;
  parent: string;
  kid: string;
  intent: string;
  summary: string;
  time: string;
}

export interface HomeResponse {
  fires: Fire[];
  approvals: Approval[];
  sessions: DashboardSession[];
  autoHandled: AutoHandled[];
  stats: { firesCount: number; handledCount: number };
}

export interface AuditEntry {
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

export interface ParentEntry {
  id: string;
  name: string;
  kids: string[];
  lastMessage: string;
}

export interface SettingsResponse {
  id: string;
  name: string;
  phone: string;
  timezone: string;
  stripeAccountId: string | null;
  autonomyEnabled: boolean;
}

// ─── Fetch wrapper ────────────────────────────────────────────────────────────

const apiUrl = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';
const token = (import.meta.env.VITE_DASHBOARD_TOKEN as string) ?? '';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-token': token,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${path}`);
  }
  return res.json() as Promise<T>;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const api = {
  home: () => apiFetch<HomeResponse>('/api/dashboard/home'),
  audit: () => apiFetch<AuditEntry[]>('/api/dashboard/audit'),
  parents: () => apiFetch<ParentEntry[]>('/api/dashboard/parents'),
  settings: () => apiFetch<SettingsResponse>('/api/dashboard/settings'),
  updateSettings: (body: { autonomyEnabled: boolean }) =>
    apiFetch<SettingsResponse>('/api/dashboard/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  sendApproval: (id: string) =>
    apiFetch<void>(`/api/dashboard/approvals/${id}/send`, { method: 'POST' }),
  dismissApproval: (id: string) =>
    apiFetch<void>(`/api/dashboard/approvals/${id}/dismiss`, { method: 'POST' }),
};
```

- [ ] **Step 2: Create .env.local**

Create `frontend/.env.local`:

```
VITE_API_URL=http://localhost:3002
VITE_DASHBOARD_TOKEN=dev-dashboard-token-local-1234
```

- [ ] **Step 3: Commit**

`.env.local` contains a secret and should stay out of git. Verify it is ignored:

```bash
grep -q ".env.local" .gitignore || echo "*.local" >> .gitignore
```

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(frontend): typed API client"
```

---

## Task 7: avatar.tsx + badges.tsx

**Files:**
- Create: `frontend/src/components/avatar.tsx`
- Create: `frontend/src/components/badges.tsx`

- [ ] **Step 1: Create avatar.tsx**

Create `frontend/src/components/avatar.tsx`:

```typescript
const COLORS = [
  '#7A8B6E', '#C47B3E', '#D4A840', '#B85C3A',
  '#6B8CAE', '#9B7BAE', '#5A8C7A', '#AE7B5A',
];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function KidAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const bg = colorFor(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg + '33',
        color: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Inter Tight, sans-serif',
        fontWeight: 600,
        fontSize: size * 0.38,
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </div>
  );
}
```

- [ ] **Step 2: Create badges.tsx**

Create `frontend/src/components/badges.tsx`:

```typescript
import { T } from '../tokens';

const INTENT_LABEL: Record<string, string> = {
  BOOK: 'Book',
  RESCHEDULE: 'Reschedule',
  CANCEL: 'Cancel',
  QUESTION_LOGISTICS: 'Logistics',
  QUESTION_PROGRESS: 'Progress',
  PAYMENT: 'Payment',
  SMALLTALK: 'Smalltalk',
  COMPLAINT: 'Complaint',
  AMBIGUOUS: 'Ambiguous',
  OUT_OF_SCOPE: 'OOS',
  NOT_PROCESSED: 'Unprocessed',
};

const INTENT_COLOR: Record<string, string> = {
  BOOK: T.moss,
  RESCHEDULE: T.amber,
  CANCEL: T.terracotta,
  QUESTION_LOGISTICS: T.moss,
  QUESTION_PROGRESS: T.moss,
  PAYMENT: T.sunrise,
  SMALLTALK: '#A8A49B',
  COMPLAINT: T.terracotta,
  AMBIGUOUS: '#A8A49B',
  OUT_OF_SCOPE: '#A8A49B',
  NOT_PROCESSED: '#A8A49B',
};

export function IntentBadge({ intent }: { intent: string }) {
  const color = INTENT_COLOR[intent] ?? '#A8A49B';
  const label = INTENT_LABEL[intent] ?? intent;
  return (
    <span
      style={{
        fontFamily: 'Geist Mono, monospace',
        fontSize: 10,
        color,
        letterSpacing: '0.06em',
      }}
    >
      {label.toUpperCase()}
    </span>
  );
}

const TIER_COLOR: Record<string, string> = {
  AUTO: T.moss,
  APPROVE: T.amber,
  ESCALATE: T.terracotta,
};

export function TierBadge({ tier }: { tier: string }) {
  const color = TIER_COLOR[tier] ?? '#A8A49B';
  return (
    <span
      style={{
        fontFamily: 'Geist Mono, monospace',
        fontSize: 10,
        color,
        background: color + '18',
        border: `1px solid ${color}44`,
        borderRadius: 4,
        padding: '1px 5px',
        letterSpacing: '0.05em',
      }}
    >
      {tier}
    </span>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/avatar.tsx frontend/src/components/badges.tsx
git commit -m "feat(frontend): KidAvatar and Intent/TierBadge components"
```

---

## Task 8: side-nav.tsx + bottom-tab-bar.tsx

**Files:**
- Create: `frontend/src/components/side-nav.tsx`
- Create: `frontend/src/components/bottom-tab-bar.tsx`

- [ ] **Step 1: Create side-nav.tsx**

Create `frontend/src/components/side-nav.tsx`:

```typescript
import { Home, ScrollText, Users, Settings } from 'lucide-react';

export type Tab = 'home' | 'audit' | 'parents' | 'settings';

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'home', icon: <Home size={20} />, label: 'Home' },
  { id: 'audit', icon: <ScrollText size={20} />, label: 'Audit' },
  { id: 'parents', icon: <Users size={20} />, label: 'Parents' },
  { id: 'settings', icon: <Settings size={20} />, label: 'Settings' },
];

export function SideNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav
      className="hidden md:flex flex-col gap-1 px-2 py-6 shrink-0"
      style={{
        width: 64,
        borderRight: '1px solid var(--hairline)',
        background: 'var(--panel-solid)',
        position: 'sticky',
        top: 0,
        height: '100dvh',
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          title={t.label}
          className="flex items-center justify-center rounded-xl p-3 transition-colors"
          style={{
            color: active === t.id ? 'var(--text)' : 'var(--muted)',
            background: active === t.id ? 'var(--surface-sub)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {t.icon}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Create bottom-tab-bar.tsx**

Create `frontend/src/components/bottom-tab-bar.tsx`:

```typescript
import { Home, ScrollText, Users, Settings } from 'lucide-react';
import type { Tab } from './side-nav';

const TABS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: 'home', icon: <Home size={22} />, label: 'Home' },
  { id: 'audit', icon: <ScrollText size={22} />, label: 'Audit' },
  { id: 'parents', icon: <Users size={22} />, label: 'Parents' },
  { id: 'settings', icon: <Settings size={22} />, label: 'Settings' },
];

export function BottomTabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 flex border-t"
      style={{
        background: 'var(--panel-solid)',
        borderColor: 'var(--hairline)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 30,
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="flex-1 flex flex-col items-center gap-1 py-3"
          style={{
            color: active === t.id ? 'var(--text)' : 'var(--muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'Inter Tight, sans-serif',
          }}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/side-nav.tsx frontend/src/components/bottom-tab-bar.tsx
git commit -m "feat(frontend): SideNav and BottomTabBar navigation components"
```

---

## Task 9: cards.tsx

**Files:**
- Create: `frontend/src/components/cards.tsx`

- [ ] **Step 1: Create cards.tsx**

Create `frontend/src/components/cards.tsx`:

```typescript
import { T } from '../tokens';
import { IntentBadge } from './badges';
import type { Fire, Approval, DashboardSession } from '../lib/api';

// ─── FireCard ────────────────────────────────────────────────────────────────

export function FireCard({ fire, onOpen }: { fire: Fire; onOpen: () => void }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2 cursor-pointer"
      style={{
        background: 'var(--panel)',
        border: `1px solid ${T.terracotta}44`,
      }}
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: T.terracotta }}
          />
          <span
            style={{
              color: 'var(--text)',
              fontSize: 14,
              fontFamily: 'Inter Tight, sans-serif',
              fontWeight: 500,
            }}
            className="truncate"
          >
            {fire.parent}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>· {fire.kid}</span>
        </div>
        <span
          style={{
            fontFamily: 'Geist Mono, monospace',
            fontSize: 11,
            color: 'var(--muted)',
            flexShrink: 0,
          }}
        >
          {fire.ago}
        </span>
      </div>
      <p
        className="text-sm leading-snug line-clamp-2"
        style={{ color: 'var(--muted)', fontStyle: 'italic' }}
      >
        "{fire.preview}"
      </p>
      <div>
        <IntentBadge intent={fire.intent} />
      </div>
    </div>
  );
}

// ─── ApprovalCard ─────────────────────────────────────────────────────────────

export function ApprovalCard({
  approval,
  onSend,
  onEdit,
}: {
  approval: Approval;
  onSend: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--hairline)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }} className="truncate">
            {approval.parent}
          </span>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>· {approval.kid}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <IntentBadge intent={approval.intent} />
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
            {approval.ago}
          </span>
        </div>
      </div>

      <div
        className="rounded-xl p-3 text-sm leading-snug"
        style={{ background: 'var(--surface-sub)', color: 'var(--muted)' }}
      >
        {approval.draft}
      </div>

      <div
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 11,
          color: 'var(--muted)',
        }}
      >
        {Math.round(approval.confidence * 100)}% · {approval.reason}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSend}
          className="flex-1 py-2 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: T.sunrise, color: '#F7F3EC', border: 'none', cursor: 'pointer' }}
        >
          Send
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2 rounded-xl text-sm transition-opacity hover:opacity-80"
          style={{
            background: 'var(--surface-sub)',
            color: 'var(--text)',
            border: '1px solid var(--hairline)',
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

export function SessionCard({
  session,
  onOpen,
}: {
  session: DashboardSession;
  onOpen: () => void;
}) {
  return (
    <div
      className="shrink-0 rounded-2xl p-4 flex flex-col gap-2 cursor-pointer"
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--hairline)',
        minWidth: 160,
      }}
      onClick={onOpen}
    >
      <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)' }}>
        {session.time} · {session.duration}
      </div>
      <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 500 }}>{session.kid}</div>
      <div
        className="text-xs leading-snug line-clamp-2"
        style={{ color: 'var(--muted)' }}
      >
        {session.note || 'No notes'}
      </div>
      <div
        style={{
          fontFamily: 'Geist Mono, monospace',
          fontSize: 10,
          color: session.paid ? T.moss : T.amber,
          letterSpacing: '0.06em',
        }}
      >
        {session.paid ? 'PAID' : 'UNPAID'}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/cards.tsx
git commit -m "feat(frontend): FireCard, ApprovalCard, SessionCard components"
```

---

## Task 10: approval-detail.tsx

**Files:**
- Create: `frontend/src/components/approval-detail.tsx`

- [ ] **Step 1: Create approval-detail.tsx**

Create `frontend/src/components/approval-detail.tsx`:

```typescript
import { X } from 'lucide-react';
import { T } from '../tokens';
import { IntentBadge } from './badges';
import type { Approval } from '../lib/api';

export function ApprovalDetail({
  approval,
  onClose,
  onSend,
  onDismiss,
}: {
  approval: Approval;
  onClose: () => void;
  onSend: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 overflow-y-auto"
      style={{ background: 'var(--bg)', zIndex: 50 }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 sticky top-0"
        style={{
          background: 'var(--panel-solid)',
          borderBottom: '1px solid var(--hairline)',
        }}
      >
        <div style={{ color: 'var(--text)', fontSize: 15, fontWeight: 500 }}>
          Draft reply
        </div>
        <button
          onClick={onClose}
          style={{ color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-4 py-6 md:px-8 flex flex-col gap-5 pb-40">
        {/* Parent info */}
        <div>
          <h1
            style={{
              fontFamily: 'Fraunces, serif',
              fontWeight: 500,
              fontSize: 26,
              color: 'var(--text)',
              margin: 0,
            }}
          >
            {approval.parent}
          </h1>
          <div
            style={{
              fontFamily: 'Geist Mono, monospace',
              fontSize: 12,
              color: 'var(--muted)',
              marginTop: 4,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <IntentBadge intent={approval.intent} />
            <span>·</span>
            <span>{Math.round(approval.confidence * 100)}% confidence</span>
            <span>·</span>
            <span>{approval.ago}</span>
          </div>
        </div>

        {/* Incoming */}
        <Field label="INCOMING">{approval.incoming}</Field>

        {/* Draft */}
        <Field label="DRAFT">{approval.draft}</Field>

        {/* Reason */}
        {approval.reason && (
          <div>
            <FieldLabel>REASON</FieldLabel>
            <div
              style={{
                fontFamily: 'Geist Mono, monospace',
                fontSize: 12,
                color: 'var(--muted)',
                marginTop: 6,
              }}
            >
              {approval.reason}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div
        className="fixed bottom-0 left-0 right-0 px-4 md:px-8 flex gap-3 py-4"
        style={{
          background: 'linear-gradient(to top, var(--bg) 60%, transparent)',
          paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
        }}
      >
        <button
          onClick={onDismiss}
          className="flex-1 py-3 rounded-2xl text-sm transition-opacity hover:opacity-70"
          style={{
            background: 'var(--surface-sub)',
            color: 'var(--text)',
            border: '1px solid var(--hairline)',
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
        <button
          onClick={onSend}
          className="flex-1 py-3 rounded-2xl text-sm font-medium transition-opacity hover:opacity-80"
          style={{ background: T.sunrise, color: '#F7F3EC', border: 'none', cursor: 'pointer' }}
        >
          Send reply
        </button>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        color: 'var(--muted)',
        fontSize: 10,
        fontFamily: 'Geist Mono, monospace',
        letterSpacing: '0.08em',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div
        className="rounded-xl p-3"
        style={{
          background: 'var(--surface-sub)',
          color: 'var(--text)',
          fontSize: 14,
          border: '1px solid var(--hairline)',
          lineHeight: 1.5,
        }}
      >
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/approval-detail.tsx
git commit -m "feat(frontend): ApprovalDetail full-screen overlay component"
```

---

## Task 11: screens/home.tsx

**Files:**
- Create: `frontend/src/components/screens/home.tsx`

- [ ] **Step 1: Create home.tsx**

Create `frontend/src/components/screens/home.tsx`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Sun, Moon } from 'lucide-react';
import { useState } from 'react';
import { api, type Approval, type HomeResponse } from '../../lib/api';
import { T } from '../../tokens';
import { FireCard, ApprovalCard, SessionCard } from '../cards';
import { ApprovalDetail } from '../approval-detail';
import { IntentBadge } from '../badges';

function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="px-4 md:px-8 mt-6 mb-3 flex items-baseline gap-2">
      <h2
        style={{
          fontFamily: 'Inter Tight, sans-serif',
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--text)',
          letterSpacing: '-0.01em',
          margin: 0,
        }}
      >
        {children}
      </h2>
      {count !== undefined && (
        <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
          {count}
        </span>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="px-4 md:px-8 mt-4 flex flex-col gap-3">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl h-24"
          style={{ background: 'var(--surface-sub)' }}
        />
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="px-4 md:px-8 mt-6">
      <div
        className="rounded-2xl p-6 flex items-center gap-3"
        style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
      >
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: T.moss + '22', color: T.moss }}
        >
          ✓
        </span>
        <div style={{ color: 'var(--text)', fontSize: 14 }}>{label}</div>
      </div>
    </div>
  );
}

function AutoHandledSection({ data }: { data: HomeResponse['autoHandled'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-4 md:px-8 mt-6 mb-24 md:mb-10">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3"
        style={{
          borderTop: '1px solid var(--hairline)',
          borderBottom: open ? 'none' : '1px solid var(--hairline)',
          background: 'none',
          cursor: 'pointer',
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: T.moss }} />
          <span style={{ color: 'var(--text)', fontSize: 14 }}>Auto-handled</span>
          <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: T.moss }}>
            {data.length} overnight
          </span>
        </div>
        <ChevronDown
          size={16}
          style={{
            color: 'var(--muted)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
          }}
        />
      </button>
      {open && (
        <div style={{ borderBottom: '1px solid var(--hairline)' }} className="pb-1">
          {data.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 py-2.5"
              style={{ borderTop: '1px solid var(--hairline)' }}
            >
              <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)', width: 46 }}>
                {a.time}
              </span>
              <div className="flex-1 min-w-0">
                <div className="truncate" style={{ color: 'var(--text)', fontSize: 14 }}>
                  {a.parent} <span style={{ color: 'var(--muted)' }}>· {a.kid}</span>
                </div>
                <div className="truncate" style={{ color: 'var(--muted)', fontSize: 13 }}>
                  {a.summary}
                </div>
              </div>
              <IntentBadge intent={a.intent} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function HomeScreen({
  theme,
  onToggleTheme,
}: {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['home'],
    queryFn: api.home,
    refetchInterval: 30_000,
  });

  const [activeApproval, setActiveApproval] = useState<Approval | null>(null);

  const sendMutation = useMutation({
    mutationFn: (id: string) => api.sendApproval(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['home'] });
      const prev = queryClient.getQueryData<HomeResponse>(['home']);
      queryClient.setQueryData<HomeResponse>(['home'], (old) =>
        old ? { ...old, approvals: old.approvals.filter((a) => a.id !== id) } : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['home'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['home'] }),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.dismissApproval(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['home'] });
      const prev = queryClient.getQueryData<HomeResponse>(['home']);
      queryClient.setQueryData<HomeResponse>(['home'], (old) =>
        old ? { ...old, approvals: old.approvals.filter((a) => a.id !== id) } : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['home'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['home'] }),
  });

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  return (
    <div>
      {/* Greeting */}
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10 flex items-start justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, lineHeight: 1.15, color: 'var(--text)', margin: 0 }}>
            {day} {greet}, Coach.
          </h1>
          <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)', marginTop: 6, letterSpacing: '0.02em' }}>
            {data ? `${data.stats.firesCount} need you · ${data.stats.handledCount} handled overnight` : '—'}
          </div>
        </div>
        <button
          onClick={onToggleTheme}
          className="p-2 rounded-full shrink-0"
          style={{ border: '1px solid var(--hairline)', color: 'var(--muted)', background: 'none', cursor: 'pointer' }}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {isLoading && <Skeleton />}

      {isError && (
        <div className="px-4 md:px-8 mt-4">
          <button
            onClick={() => void refetch()}
            className="text-sm underline"
            style={{ color: T.terracotta }}
          >
            Failed to load — tap to retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Fires */}
          {data.fires.length > 0 && (
            <>
              <SectionLabel count={data.fires.length}>Needs you.</SectionLabel>
              <div className="px-4 md:px-8 flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
                {data.fires.map((f) => (
                  <FireCard key={f.id} fire={f} onOpen={() => {}} />
                ))}
              </div>
            </>
          )}

          {/* Approvals */}
          {data.approvals.length > 0 ? (
            <>
              <SectionLabel count={data.approvals.length}>Drafted for your tap.</SectionLabel>
              <div className="px-4 md:px-8 flex flex-col gap-3 md:grid md:grid-cols-2 md:gap-4">
                {data.approvals.map((a) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    onSend={() => sendMutation.mutate(a.id)}
                    onEdit={() => setActiveApproval(a)}
                  />
                ))}
              </div>
            </>
          ) : data.fires.length === 0 ? (
            <EmptyState label="Inbox is quiet. Nothing needs you right now." />
          ) : null}

          {/* Sessions */}
          {data.sessions.length > 0 && (
            <>
              <SectionLabel count={data.sessions.length}>Today.</SectionLabel>
              <div className="px-4 md:px-8 flex gap-3 overflow-x-auto pb-2">
                {data.sessions.map((s) => (
                  <SessionCard key={s.id} session={s} onOpen={() => {}} />
                ))}
              </div>
            </>
          )}

          {/* Auto-handled */}
          <AutoHandledSection data={data.autoHandled} />
        </>
      )}

      {/* Approval detail overlay */}
      {activeApproval && (
        <ApprovalDetail
          approval={activeApproval}
          onClose={() => setActiveApproval(null)}
          onSend={() => {
            sendMutation.mutate(activeApproval.id);
            setActiveApproval(null);
          }}
          onDismiss={() => {
            dismissMutation.mutate(activeApproval.id);
            setActiveApproval(null);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/screens/home.tsx
git commit -m "feat(frontend): HomeScreen with fires, approvals, sessions, auto-handled"
```

---

## Task 12: screens/audit.tsx

**Files:**
- Create: `frontend/src/components/screens/audit.tsx`

- [ ] **Step 1: Create audit.tsx**

Create `frontend/src/components/screens/audit.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { T } from '../../tokens';
import { IntentBadge, TierBadge } from '../badges';

type Filter = 'all' | 'auto' | 'approve' | 'escalate';

const CHIPS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'auto', label: 'Auto-sent' },
  { id: 'approve', label: 'Approved' },
  { id: 'escalate', label: 'Escalated' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.08em', marginBottom: 6 }}>
        {label}
      </div>
      <div
        className="rounded-lg p-3"
        style={{ background: 'var(--surface-sub)', color: 'var(--text)', fontSize: 14, border: '1px solid var(--hairline)', lineHeight: 1.5 }}
      >
        {children}
      </div>
    </div>
  );
}

export function AuditScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['audit'],
    queryFn: api.audit,
  });

  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = (data ?? []).filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'auto') return e.action === 'AUTO_SENT';
    if (filter === 'approve') return e.action === 'QUEUED_FOR_APPROVAL';
    if (filter === 'escalate') return e.action === 'ESCALATED';
    return true;
  });

  return (
    <div className="pb-24 md:pb-10">
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10">
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, color: 'var(--text)', margin: 0 }}>
          Audit log.
        </h1>
        <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          Every decision the agent made on your behalf. Append-only.
        </div>
      </div>

      {/* Filter chips */}
      <div className="px-4 md:px-8 flex gap-2 overflow-x-auto pb-3">
        {CHIPS.map((c) => (
          <button
            key={c.id}
            onClick={() => setFilter(c.id)}
            className="px-3 py-1.5 rounded-full shrink-0"
            style={{
              fontSize: 13,
              fontFamily: 'Geist Mono, monospace',
              background: filter === c.id ? T.sunrise + '18' : 'transparent',
              color: filter === c.id ? T.sunrise : 'var(--muted)',
              border: `1px solid ${filter === c.id ? T.sunrise + '55' : 'var(--hairline)'}`,
              cursor: 'pointer',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="px-4 md:px-8 flex flex-col gap-2 mt-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse rounded h-12" style={{ background: 'var(--surface-sub)' }} />
          ))}
        </div>
      )}

      {isError && (
        <div className="px-4 md:px-8 mt-4">
          <button onClick={() => void refetch()} className="text-sm underline" style={{ color: T.terracotta }}>
            Failed to load — tap to retry
          </button>
        </div>
      )}

      <div className="md:px-8">
        {filtered.map((e) => {
          const isOpen = expanded === e.id;
          return (
            <div key={e.id} style={{ borderTop: '1px solid var(--hairline)' }}>
              <button
                className="w-full flex items-center gap-3 px-4 md:px-4 py-3 text-left"
                onClick={() => setExpanded(isOpen ? null : e.id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
              >
                <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)', width: 150, flexShrink: 0 }} className="hidden md:inline-block">
                  {e.ts}
                </span>
                <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, color: 'var(--muted)' }} className="md:hidden">
                  {e.ts.split(' ')[1]}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="truncate" style={{ color: 'var(--text)', fontSize: 14 }}>
                    {e.parent} <span style={{ color: 'var(--muted)' }}>· {e.kid}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <TierBadge tier={e.tier} />
                    <IntentBadge intent={e.intent} />
                    <span style={{ fontFamily: 'Geist Mono, monospace', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>
                      {e.action}
                    </span>
                  </div>
                </div>
                <div className="hidden md:flex flex-col items-end" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
                  <span>{e.model}</span>
                  <span>{e.tokens} tok · {e.latencyMs}ms</span>
                </div>
                <ChevronRight size={16} style={{ color: 'var(--muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
              </button>

              {isOpen && (
                <div className="px-4 md:px-4 pb-4 flex flex-col gap-3" style={{ background: 'var(--panel)' }}>
                  <Field label="INCOMING">{e.incoming}</Field>
                  <Field label="DRAFT">{e.draft}</Field>
                  <div>
                    <div style={{ color: 'var(--muted)', fontSize: 10, fontFamily: 'Geist Mono, monospace', letterSpacing: '0.08em', marginBottom: 6 }}>
                      REASONING CHAIN
                    </div>
                    <div className="flex flex-col gap-1">
                      {e.trace.map((t, i) => (
                        <div key={i} className="flex justify-between gap-3" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 12 }}>
                          <span style={{ color: 'var(--muted)' }}>→ {t.step}</span>
                          <span style={{ color: 'var(--text)', textAlign: 'right' }}>{t.verdict}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="md:hidden" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
                    {e.model} · {e.tokens} tok · {e.latencyMs}ms
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ borderTop: '1px solid var(--hairline)' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/screens/audit.tsx
git commit -m "feat(frontend): AuditScreen with filter chips and expandable decision rows"
```

---

## Task 13: screens/parents.tsx

**Files:**
- Create: `frontend/src/components/screens/parents.tsx`

- [ ] **Step 1: Create parents.tsx**

Create `frontend/src/components/screens/parents.tsx`:

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { T } from '../../tokens';
import { KidAvatar } from '../avatar';

export function ParentsScreen() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['parents'],
    queryFn: api.parents,
  });

  const [search, setSearch] = useState('');

  const filtered = (data ?? []).filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.kids.some((k) => k.toLowerCase().includes(search.toLowerCase())),
  );

  const kidCount = (data ?? []).reduce((sum, p) => sum + p.kids.length, 0);

  return (
    <div className="pb-24 md:pb-10">
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10">
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, color: 'var(--text)', margin: 0 }}>
          Parents &amp; kids.
        </h1>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
          {data ? `${data.length} families · ${kidCount} kids` : '—'}
        </div>
      </div>

      <div className="px-4 md:px-8 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search parent or kid…"
          className="w-full px-4 py-2.5 rounded-xl outline-none"
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--hairline)',
            color: 'var(--text)',
            fontSize: 14,
          }}
        />
      </div>

      {isLoading && (
        <div className="px-4 md:px-8 flex flex-col gap-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="animate-pulse rounded h-14" style={{ background: 'var(--surface-sub)' }} />
          ))}
        </div>
      )}

      {isError && (
        <div className="px-4 md:px-8">
          <button onClick={() => void refetch()} className="text-sm underline" style={{ color: T.terracotta }}>
            Failed to load — tap to retry
          </button>
        </div>
      )}

      <div className="md:px-8">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 px-4 md:px-4 py-3.5"
            style={{ borderTop: '1px solid var(--hairline)' }}
          >
            <KidAvatar name={p.name} size={40} />
            <div className="flex-1 min-w-0">
              <div style={{ color: 'var(--text)', fontSize: 15 }}>{p.name}</div>
              <div style={{ color: 'var(--muted)', fontSize: 13 }} className="truncate">
                {p.kids.join(' · ') || '— (no kids)'}
              </div>
            </div>
            <div className="hidden sm:block text-right" style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, color: 'var(--muted)' }}>
              {p.lastMessage}
            </div>
            <ChevronRight size={16} style={{ color: 'var(--muted)' }} />
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--hairline)' }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/screens/parents.tsx
git commit -m "feat(frontend): ParentsScreen with search and family directory"
```

---

## Task 14: screens/settings.tsx

**Files:**
- Create: `frontend/src/components/screens/settings.tsx`

- [ ] **Step 1: Create settings.tsx**

Create `frontend/src/components/screens/settings.tsx`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type SettingsResponse } from '../../lib/api';
import { T } from '../../tokens';

export function SettingsScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
  });

  const mutation = useMutation({
    mutationFn: (autonomyEnabled: boolean) => api.updateSettings({ autonomyEnabled }),
    onMutate: async (autonomyEnabled) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      const prev = queryClient.getQueryData<SettingsResponse>(['settings']);
      queryClient.setQueryData<SettingsResponse>(['settings'], (old) =>
        old ? { ...old, autonomyEnabled } : old,
      );
      return { prev };
    },
    onError: (_err, _val, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const autonomy = data?.autonomyEnabled ?? true;

  const profileRows = data
    ? [
        ['Coach profile', data.name],
        ['Phone', data.phone],
        ['Timezone', data.timezone],
        ['Stripe account', data.stripeAccountId ?? '—'],
      ]
    : [];

  return (
    <div className="pb-24 md:pb-10">
      <div className="px-4 pt-8 pb-4 md:px-8 md:pt-10">
        <h1 style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, fontSize: 28, color: 'var(--text)', margin: 0 }}>
          Settings.
        </h1>
      </div>

      {isLoading && (
        <div className="px-4 md:px-8">
          <div className="animate-pulse rounded-2xl h-32" style={{ background: 'var(--surface-sub)' }} />
        </div>
      )}

      {isError && (
        <div className="px-4 md:px-8">
          <button onClick={() => void refetch()} className="text-sm underline" style={{ color: T.terracotta }}>
            Failed to load — tap to retry
          </button>
        </div>
      )}

      {data && (
        <div className="px-4 md:px-8">
          {/* Autonomy toggle */}
          <div
            className="rounded-2xl p-5"
            style={{ background: 'var(--panel)', border: '1px solid var(--hairline)' }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div style={{ color: 'var(--text)', fontSize: 17 }}>Agent autonomy</div>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6, maxWidth: 420 }}>
                  When on, routine messages are auto-answered within your policy. When off, every
                  message becomes an approval — nothing goes out without your tap.
                </div>
              </div>
              <button
                onClick={() => mutation.mutate(!autonomy)}
                disabled={mutation.isPending}
                className="shrink-0 rounded-full transition-colors"
                style={{
                  width: 52,
                  height: 30,
                  background: autonomy ? T.sunrise : 'var(--surface-sub)',
                  border: '1px solid var(--hairline)',
                  position: 'relative',
                  cursor: 'pointer',
                  opacity: mutation.isPending ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: 3,
                    left: autonomy ? 24 : 3,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: '#F7F3EC',
                    transition: 'left 0.2s',
                  }}
                />
              </button>
            </div>
            <div
              style={{
                marginTop: 14,
                fontFamily: 'Geist Mono, monospace',
                fontSize: 11,
                color: autonomy ? T.moss : T.terracotta,
                letterSpacing: '0.08em',
              }}
            >
              STATUS · {autonomy ? 'ON · AGENT ACTIVE' : 'OFF · EVERYTHING QUEUED'}
            </div>
          </div>

          {/* Profile rows */}
          <div className="mt-6 flex flex-col">
            {profileRows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between py-3.5"
                style={{ borderTop: '1px solid var(--hairline)' }}
              >
                <span style={{ color: 'var(--text)', fontSize: 14 }}>{label}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13, fontFamily: 'Geist Mono, monospace' }}>
                  {value}
                </span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--hairline)' }} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/screens/settings.tsx
git commit -m "feat(frontend): SettingsScreen with autonomy toggle and coach profile"
```

---

## Task 15: App.tsx — Wire Everything

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace App.tsx**

Replace `frontend/src/App.tsx` entirely:

```typescript
import { useMemo, useState } from 'react';
import { SideNav, type Tab } from './components/side-nav';
import { BottomTabBar } from './components/bottom-tab-bar';
import { HomeScreen } from './components/screens/home';
import { AuditScreen } from './components/screens/audit';
import { ParentsScreen } from './components/screens/parents';
import { SettingsScreen } from './components/screens/settings';
import { darkVars, lightVars } from './tokens';

type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem('coach-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return 'dark';
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const themeStyle = useMemo(
    () => (theme === 'dark' ? darkVars : lightVars) as React.CSSProperties,
    [theme],
  );

  const toggleTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('coach-theme', next); } catch {}
      return next;
    });
  };

  return (
    <div
      className="min-h-dvh flex"
      style={{
        ...themeStyle,
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'Inter Tight, system-ui, sans-serif',
      }}
    >
      <SideNav active={tab} onChange={setTab} />

      <main className="flex-1 min-w-0">
        {tab === 'home' && <HomeScreen theme={theme} onToggleTheme={toggleTheme} />}
        {tab === 'audit' && <AuditScreen />}
        {tab === 'parents' && <ParentsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>

      <BottomTabBar active={tab} onChange={setTab} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): wire App.tsx with theme, tab routing, and all screens"
```

---

## Task 16: Full Smoke Test

- [ ] **Step 1: Ensure backend is running**

```bash
cd backend && pnpm start:dev
```

Wait for `NestJS application is listening on port 3002`.

- [ ] **Step 2: Start the frontend dev server**

In a second terminal:

```bash
cd frontend && pnpm dev
```

Expected: `VITE ready in Xms ➜ Local: http://localhost:5173/`

- [ ] **Step 3: Open the dashboard**

Navigate to `http://localhost:5173` in your browser.

Expected:
- Dark background loads immediately
- "Good [morning/afternoon/evening], Coach." greeting visible
- Side nav visible on desktop, bottom tab bar on mobile
- Each section ("Needs you.", "Drafted for your tap.", "Today.") renders or shows the empty state
- No console errors

- [ ] **Step 4: Test tab navigation**

Click each nav item:
- Audit → shows "Audit log." heading, filter chips, list of decisions
- Parents → shows "Parents & kids." heading, search input, family rows
- Settings → shows "Settings." heading, autonomy toggle with correct state
- Home → returns to greeting

- [ ] **Step 5: Test the autonomy toggle**

In Settings, tap the toggle. Expected:
- Toggle slides immediately (optimistic update)
- Status text changes between "ON · AGENT ACTIVE" and "OFF · EVERYTHING QUEUED"
- No console errors
- Refreshing the page preserves the setting (it comes from the DB)

- [ ] **Step 6: Test dark/light theme toggle**

On the Home screen, tap the sun/moon button in the top right. Expected:
- Background and text colors switch immediately
- Refreshing the page preserves the theme choice (localStorage)

- [ ] **Step 7: Final commit**

```bash
git add -p  # review any remaining unstaged changes
git commit -m "feat: coach dashboard — full Figma Make design connected to backend API"
```

---

## Checklist: Spec Coverage

| Spec requirement | Task(s) |
|-----------------|---------|
| Prisma migration: autonomyEnabled | Task 1 |
| DashboardModule (controller + service) | Tasks 2, 3 |
| 7 endpoints with DASHBOARD_TOKEN guard | Task 3 |
| COACH_ID env var scoping | Tasks 1, 4 |
| GET /home (fires, approvals, sessions, autoHandled) | Task 2 |
| GET /audit (100 decisions, newest first) | Task 2 |
| GET /parents (with kids + lastMessage) | Task 2 |
| GET/PATCH /settings (autonomyEnabled) | Task 2 |
| POST /approvals/:id/send → APPROVED | Task 2 |
| POST /approvals/:id/dismiss → REJECTED | Task 2 |
| Google Fonts (Fraunces, Geist Mono, Inter Tight) | Task 5 |
| tokens.ts (color tokens + CSS var maps) | Task 5 |
| lib/api.ts (typed fetch wrapper) | Task 6 |
| KidAvatar, IntentBadge, TierBadge | Task 7 |
| SideNav + BottomTabBar | Task 8 |
| FireCard, ApprovalCard, SessionCard | Task 9 |
| ApprovalDetail overlay | Task 10 |
| HomeScreen (all sections + optimistic mutations) | Task 11 |
| AuditScreen (filter chips + expandable rows) | Task 12 |
| ParentsScreen (search + directory) | Task 13 |
| SettingsScreen (toggle + profile) | Task 14 |
| App.tsx (theme, routing, localStorage) | Task 15 |
| Theme dark default + localStorage persistence | Task 15 |
| Skeleton loading states per screen | Tasks 11–14 |
| Inline error banners with retry | Tasks 11–14 |
| Optimistic approval send/dismiss | Task 11 |
| Optimistic autonomy toggle | Task 14 |
