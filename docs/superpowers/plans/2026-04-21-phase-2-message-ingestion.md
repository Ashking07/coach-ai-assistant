# Phase 2 — Message Ingestion Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pre-LLM message pipeline end-to-end: inbound HTTP → Zod-validated payload → `Message` row → BullMQ job → worker writes a placeholder `AgentDecision`. Phase 3 plugs intelligence into this plumbing without changing transport.

**Architecture:** Single choke point `MessagesService.ingest()` is the only writer of `Message` and the only producer of `MESSAGE_INGESTED` jobs. A shared `@coach/shared` workspace package holds the normalized `ParentMessage` Zod schema so the Phase 5 Twilio adapter and the internal HTTP endpoint validate against the same shape. The existing BullMQ queue (`coach-dev-test-jobs`) is reused as transport; job names differentiate work. Worker-side idempotency + boot-time recovery sweep handle the DB-vs-Redis atomicity gap.

**Tech Stack:** NestJS 11, Prisma 7 (pg adapter), BullMQ 5, Zod 4, `@nestjs/config`, Jest 30, supertest. Local Postgres on `:5433`, local Redis on `:6380` (docker-compose at repo root).

**Spec:** [docs/superpowers/specs/2026-04-21-phase-2-message-ingestion-design.md](../specs/2026-04-21-phase-2-message-ingestion-design.md)

---

## File structure

```
shared/                                              (NEW package)
  package.json                                       — { "name": "@coach/shared" }
  tsconfig.json
  src/index.ts                                       — re-exports
  src/types/parent-message.ts                        — Zod schema + type

backend/src/modules/messages/                        (NEW module)
  messages.module.ts                                 — registers controller + service
  messages.controller.ts                             — POST /api/messages/inbound
  messages.service.ts                                — ingest(), recoverOrphanedMessages()
  messages.service.spec.ts                           — unit tests (mocked Prisma + queue)
  messages.controller.spec.ts                        — unit tests (mocked service)
  dto/parent-message.dto.ts                          — re-export of shared schema

backend/src/common/
  timing-safe-equal.ts                               — constant-time string compare
  env.validation.ts                                  — Zod validator for process.env

backend/src/bullmq.constants.ts                      — MODIFY: add MESSAGE_INGESTED_JOB
backend/src/worker.ts                                — MODIFY: branch on job.name, recovery sweep
backend/src/app.module.ts                            — MODIFY: ConfigModule + MessagesModule
backend/prisma/schema.prisma                         — MODIFY: Parent.isVerified, Intent.NOT_PROCESSED, nullable AgentDecision LLM fields
backend/prisma/migrations/<ts>_add_verified_parent_and_nullable_agent_decision/migration.sql  (generated)

backend/test/messages.e2e-spec.ts                    — NEW e2e tests

backend/.env.example                                 — MODIFY: add INTERNAL_INGEST_TOKEN
pnpm-workspace.yaml                                  — already lists `shared`; no change
context.md                                           — MODIFY: Phase 2 bullet + data model deltas
CLAUDE.md                                            — MODIFY: add INTERNAL_INGEST_TOKEN + e2e command
```

Each task below lists the exact files it touches.

---

## Task 1: Create `@coach/shared` workspace package

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `shared/src/types/parent-message.ts`

- [ ] **Step 1: Create `shared/package.json`**

```json
{
  "name": "@coach/shared",
  "version": "0.0.1",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types/parent-message": "./src/types/parent-message.ts"
  },
  "dependencies": {
    "zod": "^4.3.6"
  }
}
```

Note: we intentionally point `main` at the `.ts` source. The backend transpiles via `ts-jest`/`ts-node` and Nest CLI, all of which read TS sources; no separate build step for `shared` is needed in Phase 2.

- [ ] **Step 2: Create `shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `shared/src/types/parent-message.ts`**

```ts
import { z } from 'zod';

export const ChannelSchema = z.enum(['SMS', 'WEB_CHAT', 'VOICE']);
export type Channel = z.infer<typeof ChannelSchema>;

export const ParentMessageSchema = z.object({
  coachId: z.string().min(1),
  channel: ChannelSchema,
  fromPhone: z.string().regex(/^\+[1-9]\d{1,14}$/, 'must be E.164'),
  fromName: z.string().optional(),
  content: z.string().min(1).max(4000),
  providerMessageId: z.string().min(1),
  receivedAt: z.coerce.date().default(() => new Date()),
});

export type ParentMessage = z.infer<typeof ParentMessageSchema>;
```

- [ ] **Step 4: Create `shared/src/index.ts`**

```ts
export * from './types/parent-message';
```

- [ ] **Step 5: Install workspace dependency in backend**

Run from repo root:

```bash
pnpm add --filter backend @coach/shared@workspace:*
pnpm install
```

Expected: `backend/package.json` gains `"@coach/shared": "workspace:*"`. `pnpm install` links the workspace package into `backend/node_modules/@coach/shared`.

- [ ] **Step 6: Verify the import resolves**

Run from repo root:

```bash
pnpm --filter backend exec node -e "console.log(Object.keys(require('@coach/shared')))"
```

Expected output includes `ChannelSchema`, `ParentMessageSchema`.

- [ ] **Step 7: Commit**

```bash
git add shared/ pnpm-workspace.yaml backend/package.json pnpm-lock.yaml
git commit -m "feat(shared): add @coach/shared package with ParentMessage Zod schema"
```

---

## Task 2: Schema migration — `add_verified_parent_and_nullable_agent_decision`

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_verified_parent_and_nullable_agent_decision/migration.sql` (generated)

- [ ] **Step 1: Edit Parent model — add `isVerified`**

In `backend/prisma/schema.prisma`, inside `model Parent`, add after `preferredChannel`:

```prisma
isVerified      Boolean  @default(false)
```

- [ ] **Step 2: Edit Intent enum — add `NOT_PROCESSED`**

Append to `enum Intent` (order doesn't matter to Prisma, but keep it last for clarity):

```prisma
NOT_PROCESSED
```

- [ ] **Step 3: Edit AgentDecision — nullable LLM fields**

Replace the non-null `confidence`, `tier`, `reasoning`, `llmModel`, `tokensIn`, `tokensOut`, `latencyMs` lines with:

```prisma
confidence  Float?
tier        ConfidenceTier?
reasoning   String?
llmModel    String?
tokensIn    Int?
tokensOut   Int?
latencyMs   Int?
```

`actionTaken` stays non-null (it's always set, `"INGESTED"` for placeholder rows).

- [ ] **Step 4: Ensure docker Postgres is running**

```bash
docker compose up -d postgres
```

Expected: `postgres` container listed as running (or already running).

- [ ] **Step 5: Generate and apply the migration**

From `backend/`:

```bash
pnpm prisma migrate dev --name add_verified_parent_and_nullable_agent_decision
```

Expected: Prisma creates a new folder under `prisma/migrations/` with a `migration.sql` that:
- adds `"isVerified" BOOLEAN NOT NULL DEFAULT false` to `Parent`
- adds `'NOT_PROCESSED'` to the `Intent` enum
- alters `confidence`, `tier`, `reasoning`, `llmModel`, `tokensIn`, `tokensOut`, `latencyMs` on `AgentDecision` to `DROP NOT NULL`

and then applies it. Prisma Client regenerates.

- [ ] **Step 6: Verify migration contents**

```bash
ls backend/prisma/migrations/
```

Open the new `migration.sql` and confirm the four changes above are present. If any are missing, the schema edit was incomplete — fix the `.prisma` file and re-run migrate dev.

- [ ] **Step 7: Run seed to prove it still works**

```bash
pnpm --filter backend exec prisma db seed
```

Expected: seed completes without error; DB still has 1 coach, 5 parents, 5 kids, 10 sessions (per the existing idempotent seed).

- [ ] **Step 8: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(prisma): add Parent.isVerified, Intent.NOT_PROCESSED, nullable AgentDecision LLM fields"
```

---

## Task 3: Environment validation + `timingSafeEqualStr` helper

**Files:**
- Create: `backend/src/common/timing-safe-equal.ts`
- Create: `backend/src/common/env.validation.ts`
- Create: `backend/src/common/timing-safe-equal.spec.ts`
- Modify: `backend/.env.example` (create if missing)
- Modify: `backend/.env` (local only, not committed — add the token)

- [ ] **Step 1: Write the failing test for `timingSafeEqualStr`**

Create `backend/src/common/timing-safe-equal.spec.ts`:

```ts
import { timingSafeEqualStr } from './timing-safe-equal';

describe('timingSafeEqualStr', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualStr('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(timingSafeEqualStr('abc123', 'abc124')).toBe(false);
  });

  it('returns false for strings of different lengths (no throw)', () => {
    expect(timingSafeEqualStr('short', 'longer-string')).toBe(false);
  });

  it('returns false when one side is empty', () => {
    expect(timingSafeEqualStr('', 'something')).toBe(false);
    expect(timingSafeEqualStr('something', '')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter backend test -- timing-safe-equal
```

Expected: FAIL — "Cannot find module './timing-safe-equal'".

- [ ] **Step 3: Implement `timingSafeEqualStr`**

Create `backend/src/common/timing-safe-equal.ts`:

```ts
import { timingSafeEqual } from 'node:crypto';

export function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // timingSafeEqual requires equal-length buffers. Length leakage for
    // secrets of a fixed expected size is acceptable here.
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter backend test -- timing-safe-equal
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Implement env validator**

Create `backend/src/common/env.validation.ts`:

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  INTERNAL_INGEST_TOKEN: z.string().min(16, 'INTERNAL_INGEST_TOKEN must be >=16 chars'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
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

- [ ] **Step 6: Add token to local `.env` and `.env.example`**

Append to `backend/.env`:

```
INTERNAL_INGEST_TOKEN=dev-local-ingest-token-please-change-me
```

Create or update `backend/.env.example`:

```
DATABASE_URL=postgresql://coach:coach@localhost:5433/coach_local
REDIS_URL=redis://localhost:6380
INTERNAL_INGEST_TOKEN=replace-me-with-32-random-bytes
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/common/ backend/.env.example
git commit -m "feat(backend): add timingSafeEqualStr helper and env validation schema"
```

(`backend/.env` is gitignored; not committed.)

---

## Task 4: Wire `ConfigModule` into `AppModule` with fail-fast validation

**Files:**
- Modify: `backend/src/app.module.ts`

- [ ] **Step 1: Read current `AppModule`**

Already read at plan-writing time. Current state registers `BullMqModule`, `AppController`, `AppService`, `PrismaService`. No `ConfigModule`.

- [ ] **Step 2: Write a failing boot test**

Create `backend/src/app.module.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule bootstrap env validation', () => {
  const originalEnv = process.env.INTERNAL_INGEST_TOKEN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.INTERNAL_INGEST_TOKEN;
    } else {
      process.env.INTERNAL_INGEST_TOKEN = originalEnv;
    }
  });

  it('throws when INTERNAL_INGEST_TOKEN is missing', async () => {
    delete process.env.INTERNAL_INGEST_TOKEN;
    await expect(
      Test.createTestingModule({ imports: [AppModule] }).compile(),
    ).rejects.toThrow(/INTERNAL_INGEST_TOKEN/);
  });

  it('boots when INTERNAL_INGEST_TOKEN is set', async () => {
    process.env.INTERNAL_INGEST_TOKEN = 'x'.repeat(32);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
```

- [ ] **Step 3: Run to verify the first test fails**

```bash
pnpm --filter backend test -- app.module
```

Expected: test "throws when INTERNAL_INGEST_TOKEN is missing" FAILS (module boots without validation).

- [ ] **Step 4: Modify `backend/src/app.module.ts`**

Replace contents with:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BullMqModule } from './bullmq.module';
import { PrismaService } from './prisma.service';
import { validateEnv } from './common/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    BullMqModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
```

- [ ] **Step 5: Run tests to verify both pass**

```bash
pnpm --filter backend test -- app.module
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.module.ts backend/src/app.module.spec.ts
git commit -m "feat(backend): fail-fast env validation via ConfigModule in AppModule"
```

---

## Task 5: Add `MESSAGE_INGESTED` job-name constant

**Files:**
- Modify: `backend/src/bullmq.constants.ts`

- [ ] **Step 1: Add the constant**

Edit `backend/src/bullmq.constants.ts` — append:

```ts
export const MESSAGE_INGESTED_JOB = 'MESSAGE_INGESTED';
```

Keep `DEV_TEST_QUEUE`, `getRedisUrl`, `getQueueName` unchanged. Both `/dev/test-job` (smoke) and `MESSAGE_INGESTED` (real work) use the same queue; job names differentiate.

- [ ] **Step 2: Commit**

```bash
git add backend/src/bullmq.constants.ts
git commit -m "feat(backend): add MESSAGE_INGESTED_JOB constant"
```

---

## Task 6: `MessagesService` — unit tests first

**Files:**
- Create: `backend/src/modules/messages/messages.service.spec.ts`
- Create: `backend/src/modules/messages/messages.service.ts` (stub only in this task)
- Create: `backend/src/modules/messages/messages.module.ts`

- [ ] **Step 1: Scaffold an empty service + module (so Nest testing can compile)**

Create `backend/src/modules/messages/messages.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { TEST_JOB_QUEUE } from '../../bullmq.module';
import type { ParentMessage } from '@coach/shared';

export type IngestResult =
  | { messageId: string; duplicate: false; enqueued: true; jobId: string }
  | { messageId: string; duplicate: true; enqueued: false; jobId: null };

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TEST_JOB_QUEUE) private readonly queue: Queue,
  ) {}

  async ingest(_msg: ParentMessage): Promise<IngestResult> {
    throw new Error('not implemented');
  }

  async recoverOrphanedMessages(): Promise<number> {
    throw new Error('not implemented');
  }
}
```

Create `backend/src/modules/messages/messages.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MessagesService } from './messages.service';

@Module({
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
```

- [ ] **Step 2: Write the four failing service unit tests**

Create `backend/src/modules/messages/messages.service.spec.ts`:

```ts
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm --filter backend test -- messages.service
```

Expected: 4 tests FAIL (service throws `not implemented`).

- [ ] **Step 4: Implement `MessagesService.ingest()`**

Replace `backend/src/modules/messages/messages.service.ts` with:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma.service';
import { TEST_JOB_QUEUE } from '../../bullmq.module';
import { MESSAGE_INGESTED_JOB } from '../../bullmq.constants';
import type { ParentMessage } from '@coach/shared';

export type IngestResult =
  | { messageId: string; duplicate: false; enqueued: true; jobId: string }
  | { messageId: string; duplicate: true; enqueued: false; jobId: null };

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(TEST_JOB_QUEUE) private readonly queue: Queue,
  ) {}

  async ingest(msg: ParentMessage): Promise<IngestResult> {
    const parent = await this.prisma.parent.upsert({
      where: { coachId_phone: { coachId: msg.coachId, phone: msg.fromPhone } },
      create: {
        coachId: msg.coachId,
        phone: msg.fromPhone,
        name: msg.fromName ?? `Unknown (${msg.fromPhone})`,
        preferredChannel: msg.channel === 'VOICE' ? 'SMS' : msg.channel,
        isVerified: false,
      },
      update: {},
    });

    const freshParent =
      parent.updatedAt == null ||
      parent.createdAt.getTime() === parent.updatedAt.getTime();
    if (freshParent) {
      this.logger.log(
        {
          event: 'UNKNOWN_PARENT_CREATED',
          coachId: msg.coachId,
          parentId: parent.id,
          phone: msg.fromPhone,
          channel: msg.channel,
        },
        MessagesService.name,
      );
    }

    const existing = await this.prisma.message.findUnique({
      where: {
        channel_providerMessageId: {
          channel: msg.channel,
          providerMessageId: msg.providerMessageId,
        },
      },
      select: { id: true },
    });
    if (existing) {
      this.logger.warn(
        {
          event: 'DUPLICATE_MESSAGE_DROPPED',
          messageId: existing.id,
          channel: msg.channel,
          providerMessageId: msg.providerMessageId,
        },
        MessagesService.name,
      );
      return { messageId: existing.id, duplicate: true, enqueued: false, jobId: null };
    }

    const message = await this.prisma.message.create({
      data: {
        coachId: msg.coachId,
        parentId: parent.id,
        direction: 'INBOUND',
        channel: msg.channel,
        providerMessageId: msg.providerMessageId,
        content: msg.content,
        receivedAt: msg.receivedAt,
      },
    });

    const job = await this.queue.add(MESSAGE_INGESTED_JOB, { messageId: message.id });

    return {
      messageId: message.id,
      duplicate: false,
      enqueued: true,
      jobId: String(job.id),
    };
  }

  async recoverOrphanedMessages(): Promise<number> {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const orphans = await this.prisma.message.findMany({
      where: {
        direction: 'INBOUND',
        receivedAt: { gte: sinceIso },
        agentDecisions: { none: {} },
      },
      select: { id: true, receivedAt: true },
    });
    for (const o of orphans) {
      await this.queue.add(MESSAGE_INGESTED_JOB, { messageId: o.id });
      this.logger.log(
        {
          event: 'ORPHAN_MESSAGE_REENQUEUED',
          messageId: o.id,
          ageSeconds: Math.round((Date.now() - o.receivedAt.getTime()) / 1000),
        },
        MessagesService.name,
      );
    }
    return orphans.length;
  }
}
```

- [ ] **Step 5: Run unit tests to verify they pass**

```bash
pnpm --filter backend test -- messages.service
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/messages/
git commit -m "feat(messages): MessagesService.ingest with idempotency + recovery sweep"
```

---

## Task 7: `MessagesController` — unit tests first, then implementation

**Files:**
- Create: `backend/src/modules/messages/messages.controller.ts`
- Create: `backend/src/modules/messages/messages.controller.spec.ts`
- Create: `backend/src/modules/messages/dto/parent-message.dto.ts`
- Modify: `backend/src/modules/messages/messages.module.ts`

- [ ] **Step 1: Re-export shared schema as DTO**

Create `backend/src/modules/messages/dto/parent-message.dto.ts`:

```ts
export {
  ParentMessageSchema,
  ChannelSchema,
  type ParentMessage,
  type Channel,
} from '@coach/shared';
```

- [ ] **Step 2: Scaffold a stub controller so the spec compiles**

Create `backend/src/modules/messages/messages.controller.ts`:

```ts
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from './messages.service';

@Controller('api/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  @HttpCode(200)
  async inbound(
    @Headers('x-internal-token') _token: string | undefined,
    @Body() _body: unknown,
  ): Promise<{ messageId: string; duplicate: boolean }> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 3: Write the four failing controller unit tests**

Create `backend/src/modules/messages/messages.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

const TOKEN = 'x'.repeat(32);

describe('MessagesController.inbound', () => {
  let controller: MessagesController;
  let service: { ingest: jest.Mock };

  beforeEach(async () => {
    service = { ingest: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      controllers: [MessagesController],
      providers: [
        { provide: MessagesService, useValue: service },
        {
          provide: ConfigService,
          useValue: { getOrThrow: (k: string) => (k === 'INTERNAL_INGEST_TOKEN' ? TOKEN : undefined) },
        },
      ],
    }).compile();
    controller = moduleRef.get(MessagesController);
  });

  const goodBody = {
    coachId: 'demo-coach',
    channel: 'WEB_CHAT',
    fromPhone: '+15555550001',
    content: 'hi',
    providerMessageId: 'web-uuid-1',
  };

  it('missing token → 401', async () => {
    await expect(controller.inbound(undefined, goodBody)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('wrong token → 401', async () => {
    await expect(controller.inbound('wrong-token', goodBody)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('valid token + malformed body → 422 with issues', async () => {
    const bad = { ...goodBody, fromPhone: 'not-e164' };
    const err = await controller.inbound(TOKEN, bad).catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const resp = (err as UnprocessableEntityException).getResponse() as { issues: unknown[] };
    expect(Array.isArray(resp.issues)).toBe(true);
    expect(resp.issues.length).toBeGreaterThan(0);
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('valid token + good body → delegates to service, returns {messageId, duplicate}', async () => {
    service.ingest.mockResolvedValue({
      messageId: 'msg-1',
      duplicate: false,
      enqueued: true,
      jobId: 'job-1',
    });
    const result = await controller.inbound(TOKEN, goodBody);
    expect(service.ingest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messageId: 'msg-1', duplicate: false });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm --filter backend test -- messages.controller
```

Expected: all 4 tests FAIL.

- [ ] **Step 5: Implement the controller**

Replace `backend/src/modules/messages/messages.controller.ts`:

```ts
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from './messages.service';
import { ParentMessageSchema } from './dto/parent-message.dto';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';

@Controller('api/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  @HttpCode(200)
  async inbound(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ messageId: string; duplicate: boolean }> {
    const expected = this.config.getOrThrow<string>('INTERNAL_INGEST_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }
    const parsed = ParentMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: 'Invalid message payload',
        issues: parsed.error.issues,
      });
    }
    const result = await this.messagesService.ingest(parsed.data);
    return { messageId: result.messageId, duplicate: result.duplicate };
  }
}
```

- [ ] **Step 6: Register controller in `MessagesModule`**

Edit `backend/src/modules/messages/messages.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
```

- [ ] **Step 7: Import `MessagesModule` in `AppModule`**

Edit `backend/src/app.module.ts` — add import and include in `imports`:

```ts
import { MessagesModule } from './modules/messages/messages.module';
// ...
imports: [
  ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
  BullMqModule,
  MessagesModule,
],
```

- [ ] **Step 8: Run controller tests to verify they pass**

```bash
pnpm --filter backend test -- messages.controller
```

Expected: 4 tests PASS.

- [ ] **Step 9: Run the full unit suite to confirm nothing regressed**

```bash
pnpm --filter backend test
```

Expected: all tests PASS (app.controller, app.module, timing-safe-equal, messages.service, messages.controller).

- [ ] **Step 10: Commit**

```bash
git add backend/src/modules/messages/ backend/src/app.module.ts
git commit -m "feat(messages): POST /api/messages/inbound with token auth and Zod validation"
```

---

## Task 8: Worker — handle `MESSAGE_INGESTED` + recovery sweep on boot

**Files:**
- Modify: `backend/src/worker.ts`

- [ ] **Step 1: Replace worker contents**

Replace `backend/src/worker.ts` with:

```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { z } from 'zod';
import { getQueueName, getRedisUrl, MESSAGE_INGESTED_JOB } from './bullmq.constants';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { MessagesService } from './modules/messages/messages.module';

const MessageIngestedPayload = z.object({ messageId: z.string().min(1) });

export function startWorker(prisma: PrismaService) {
  const queueName = getQueueName();
  const connection = new IORedis(getRedisUrl(), { maxRetriesPerRequest: null });

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      if (job.name === MESSAGE_INGESTED_JOB) {
        const { messageId } = MessageIngestedPayload.parse(job.data);

        const existing = await prisma.agentDecision.findFirst({
          where: { messageId },
          select: { id: true },
        });
        if (existing) {
          return { ok: true, skipped: 'already_processed' };
        }

        const message = await prisma.message.findUniqueOrThrow({
          where: { id: messageId },
          include: { parent: true },
        });

        await prisma.agentDecision.create({
          data: {
            coachId: message.coachId,
            messageId: message.id,
            intent: 'NOT_PROCESSED',
            actionTaken: 'INGESTED',
          },
        });

        await prisma.message.update({
          where: { id: message.id },
          data: { processedAt: new Date() },
        });

        return { ok: true };
      }

      // Legacy smoke-test handler — keep working so /dev/test-job still verifies plumbing.
      const message = job.data?.message ?? 'hello';
      console.log(`Received: ${message}`);
      return { ok: true };
    },
    { connection },
  );

  worker.on('completed', (job) => {
    console.log(`Completed job ${job.id} (${job.name}) from ${queueName}`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id ?? 'unknown'} (${job?.name ?? '?'}) failed in ${queueName}`, error);
  });

  console.log(`Worker listening on queue ${queueName}`);

  return {
    worker,
    connection,
    close: async () => {
      await worker.close();
      await connection.quit();
    },
  };
}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const messagesService = app.get(MessagesService);

  const recovered = await messagesService.recoverOrphanedMessages();
  if (recovered > 0) {
    console.log(`Recovered ${recovered} orphaned messages on boot`);
  }

  const { close } = startWorker(prisma);

  const shutdown = async () => {
    await close();
    await app.close();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

if (require.main === module) {
  void bootstrap();
}
```

Note: import `MessagesService` via `./modules/messages/messages.module` only works if it's re-exported there. The `messages.module.ts` already exports the provider class through the `exports: [MessagesService]` symbol table — but to import the *type*, source it directly. Use this import instead:

```ts
import { MessagesService } from './modules/messages/messages.service';
```

(Replace that import line accordingly.)

- [ ] **Step 2: Typecheck by building**

```bash
pnpm --filter backend build
```

Expected: build succeeds. If it errors on missing fields or imports, fix and re-run.

- [ ] **Step 3: Commit**

```bash
git add backend/src/worker.ts
git commit -m "feat(worker): handle MESSAGE_INGESTED jobs and run recovery sweep on boot"
```

---

## Task 9: Integration tests (e2e) — 5 cases

**Files:**
- Create: `backend/test/messages.e2e-spec.ts`
- Modify: `backend/test/jest-e2e.json` (only if needed for setup/timeout)

- [ ] **Step 1: Check current e2e config**

```bash
cat backend/test/jest-e2e.json
```

Note the structure. If `testTimeout` is not set, we'll set it per-test via `jest.setTimeout(30000)` in the spec file.

- [ ] **Step 2: Write the five e2e tests**

Create `backend/test/messages.e2e-spec.ts`:

```ts
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

const TOKEN = process.env.INTERNAL_INGEST_TOKEN!;
const COACH_ID = 'demo-coach';

async function waitForDecision(prisma: PrismaService, messageId: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await prisma.agentDecision.findFirst({ where: { messageId } });
    if (d) return d;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No AgentDecision appeared for message ${messageId} within ${timeoutMs}ms`);
}

describe('POST /api/messages/inbound (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let workerHandle: ReturnType<typeof startWorker>;

  beforeAll(async () => {
    if (!TOKEN) throw new Error('INTERNAL_INGEST_TOKEN must be set for e2e');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    workerHandle = startWorker(prisma);
  });

  afterAll(async () => {
    await workerHandle.close();
    await app.close();
  });

  async function cleanup(phones: string[], providerIds: string[]) {
    await prisma.agentDecision.deleteMany({
      where: { message: { providerMessageId: { in: providerIds } } },
    });
    await prisma.message.deleteMany({ where: { providerMessageId: { in: providerIds } } });
    await prisma.parent.deleteMany({ where: { coachId: COACH_ID, phone: { in: phones } } });
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
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ duplicate: false });
      expect(res.body.messageId).toEqual(expect.any(String));

      const decision = await waitForDecision(prisma, res.body.messageId);
      expect(decision.intent).toBe('NOT_PROCESSED');
      expect(decision.actionTaken).toBe('INGESTED');
      expect(decision.confidence).toBeNull();
      expect(decision.tier).toBeNull();
      expect(decision.reasoning).toBeNull();
      expect(decision.llmModel).toBeNull();
      expect(decision.tokensIn).toBeNull();
      expect(decision.tokensOut).toBeNull();
      expect(decision.latencyMs).toBeNull();

      const msg = await prisma.message.findUnique({ where: { id: res.body.messageId } });
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
      where: { channel_providerMessageId: { channel: 'WEB_CHAT', providerMessageId: providerId } },
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
      expect(a.status).toBe(200);
      expect(a.body.duplicate).toBe(false);

      await waitForDecision(prisma, a.body.messageId);

      const b = await request(app.getHttpServer())
        .post('/api/messages/inbound')
        .set('x-internal-token', TOKEN)
        .send(body);
      expect(b.status).toBe(200);
      expect(b.body).toEqual({ messageId: a.body.messageId, duplicate: true });

      const decisions = await prisma.agentDecision.findMany({
        where: { messageId: a.body.messageId },
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

  it('5. recovery sweep: orphan Message → worker boot re-enqueues → AgentDecision appears', async () => {
    const phone = '+15550000005';
    const providerId = `e2e-${randomUUID()}`;
    try {
      // Intentionally bypass ingest() — this is the one allowed exception (Invariant #1).
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

      // Simulate worker restart: close current worker, boot a fresh one which runs recoverOrphanedMessages().
      await workerHandle.close();
      const messagesService = app.get(MessagesService);
      const recovered = await messagesService.recoverOrphanedMessages();
      expect(recovered).toBeGreaterThanOrEqual(1);
      workerHandle = startWorker(prisma);

      const decision = await waitForDecision(prisma, orphan.id);
      expect(decision.intent).toBe('NOT_PROCESSED');
      expect(decision.actionTaken).toBe('INGESTED');
    } finally {
      await cleanup([phone], [providerId]);
    }
  });
});
```

- [ ] **Step 3: Ensure Postgres and Redis are up**

```bash
docker compose up -d
```

Expected: both `postgres` and `redis` containers running.

- [ ] **Step 4: Ensure `INTERNAL_INGEST_TOKEN` is present in `backend/.env`**

From Task 3 Step 6 — already set. Quickly verify:

```bash
pnpm --filter backend exec node -e "require('dotenv').config();console.log(process.env.INTERNAL_INGEST_TOKEN ? 'set' : 'MISSING')"
```

Expected: `set`.

- [ ] **Step 5: Run the e2e spec**

```bash
pnpm --filter backend test:e2e -- messages
```

Expected: 5 tests PASS. If any test flakes on timing, increase the `waitForDecision` timeout to 10000ms — but only if the failure is genuinely timing, not a logic bug.

- [ ] **Step 6: Commit**

```bash
git add backend/test/messages.e2e-spec.ts
git commit -m "test(messages): e2e coverage for happy path, auth, idempotency, unknown parent, recovery"
```

---

## Task 10: Dev smoke test via curl (manual verification)

**Files:** none — this is a manual verification step that gets captured as a comment in the PR description.

- [ ] **Step 1: Start Postgres + Redis**

```bash
docker compose up -d
```

- [ ] **Step 2: Start backend web server (terminal 1)**

```bash
pnpm --filter backend start:dev
```

Expected log: `Nest application successfully started` on port 3002. If env validation fails, it will crash with a clear `INTERNAL_INGEST_TOKEN` error — this proves fail-fast works.

- [ ] **Step 3: Start worker (terminal 2)**

```bash
pnpm --filter backend start:worker:dev
```

Expected log: `Worker listening on queue coach-dev-test-jobs`. If there are orphans from earlier development, you'll also see `Recovered N orphaned messages on boot`.

- [ ] **Step 4: POST a fresh message**

```bash
TOKEN=$(grep INTERNAL_INGEST_TOKEN backend/.env | cut -d= -f2)
curl -s -X POST http://localhost:3002/api/messages/inbound \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: $TOKEN" \
  -d '{
    "coachId":"demo-coach",
    "channel":"WEB_CHAT",
    "fromPhone":"+15559998888",
    "fromName":"Manual Smoke",
    "content":"hello manual",
    "providerMessageId":"manual-smoke-1"
  }'
```

Expected response: `{"messageId":"...","duplicate":false}`

Worker terminal should log `Completed job <id> (MESSAGE_INGESTED) from coach-dev-test-jobs`.

- [ ] **Step 5: Verify the DB row**

```bash
docker compose exec postgres psql -U coach -d coach_local -c \
  "SELECT m.id, m.content, ad.intent, ad.\"actionTaken\", ad.confidence FROM \"Message\" m JOIN \"AgentDecision\" ad ON ad.\"messageId\" = m.id WHERE m.\"providerMessageId\"='manual-smoke-1';"
```

Expected: one row. `intent=NOT_PROCESSED`, `actionTaken=INGESTED`, `confidence=<null>`.

- [ ] **Step 6: POST the same payload again (idempotency)**

Re-run the curl from Step 4. Expected: `{"messageId":"<same id>","duplicate":true}` and the DB still has exactly one `Message` and one `AgentDecision` for `manual-smoke-1`.

- [ ] **Step 7: POST with wrong token (auth)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3002/api/messages/inbound \
  -H "Content-Type: application/json" \
  -H "X-Internal-Token: wrong" \
  -d '{"coachId":"demo-coach","channel":"WEB_CHAT","fromPhone":"+15559990000","content":"x","providerMessageId":"nope"}'
```

Expected: `401`.

- [ ] **Step 8: Clean up the smoke-test row (optional)**

```bash
docker compose exec postgres psql -U coach -d coach_local -c \
  "DELETE FROM \"AgentDecision\" WHERE \"messageId\" IN (SELECT id FROM \"Message\" WHERE \"providerMessageId\"='manual-smoke-1'); DELETE FROM \"Message\" WHERE \"providerMessageId\"='manual-smoke-1'; DELETE FROM \"Parent\" WHERE phone='+15559998888';"
```

No commit — this task is verification, not code.

---

## Task 11: Documentation updates — `context.md` and `CLAUDE.md`

**Files:**
- Modify: `context.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `context.md` Phase 2 description**

Locate the Phase 2 bullet in `context.md` and replace any "Twilio-shaped" phrasing with:

> Phase 2 — Message ingestion pipeline: inbound HTTP accepts the normalized `ParentMessage` JSON (Zod-validated, schema in `@coach/shared`); `MessagesService.ingest()` is the single choke point that writes `Message` and enqueues `MESSAGE_INGESTED`; worker writes a placeholder `AgentDecision` (`intent=NOT_PROCESSED`, `actionTaken=INGESTED`).

- [ ] **Step 2: Update `context.md` Data Model section**

- Add `isVerified: Boolean (default false)` to the `Parent` fields.
- Add `NOT_PROCESSED` to the `Intent` enum list with a one-line note: "sentinel for pre-agent rows; never produced by the LLM."
- Mark `AgentDecision.{confidence, tier, reasoning, llmModel, tokensIn, tokensOut, latencyMs}` as nullable, with a note: "null for placeholder rows written before the agent state machine is reached."

- [ ] **Step 3: Update `CLAUDE.md`**

Under **Common backend commands**, add below the existing `test:e2e` line:

```bash
pnpm --filter backend test:e2e -- messages   # Phase 2 ingestion integration test
```

Under the environment / deployment notes, add `INTERNAL_INGEST_TOKEN` to the list of required env vars (both locally and in Render). One line:

> `INTERNAL_INGEST_TOKEN` — secret for `POST /api/messages/inbound`. Must be set; app crashes on boot if missing.

- [ ] **Step 4: Commit**

```bash
git add context.md CLAUDE.md
git commit -m "docs: document Phase 2 ingestion pipeline and INTERNAL_INGEST_TOKEN"
```

---

## Task 12: Final verification pass

- [ ] **Step 1: Run the full backend unit suite**

```bash
pnpm --filter backend test
```

Expected: all PASS. If any spec was broken by a refactor, fix it before proceeding.

- [ ] **Step 2: Run the backend e2e suite**

```bash
pnpm --filter backend test:e2e
```

Expected: all PASS (including existing `app.e2e-spec.ts` and the new `messages.e2e-spec.ts`).

- [ ] **Step 3: Lint**

```bash
pnpm --filter backend lint
```

Expected: no errors.

- [ ] **Step 4: Build**

```bash
pnpm --filter backend build
```

Expected: build succeeds.

- [ ] **Step 5: Confirm invariants by grep**

Verify no code outside `messages.service.ts` writes to `Message`:

```bash
# Should only match messages.service.ts (ingest) and messages.e2e-spec.ts (Test #5, explicitly allowed).
grep -rn "prisma.message.create\|prisma\.message\.upsert" backend/src backend/test
```

Verify no code outside the worker writes to `AgentDecision` in Phase 2:

```bash
# Should only match worker.ts and messages.e2e-spec.ts (Test #5 cleanup deletes).
grep -rn "prisma\.agentDecision\.create" backend/src backend/test
```

If either grep returns unexpected hits, address them before the PR.

- [ ] **Step 6: Tag the plan complete by closing the branch**

```bash
git log --oneline main..HEAD
```

Expected: ~10 Phase-2 commits, starting with the shared package and ending with docs.

No commit for this task.

---

## Self-review

**Spec coverage check** (re-read the spec; every requirement maps to a task):

- Invariants 1–4 → enforced by Task 6 (service code path), Task 8 (worker), Task 12 Step 5 (grep check).
- Schema changes → Task 2.
- Shared Zod schema → Task 1.
- `MessagesService.ingest()` signature + body → Task 6.
- Atomicity & recovery → Task 6 Step 4 (order) + `recoverOrphanedMessages` impl + Task 8 bootstrap call + e2e Test #5.
- `POST /api/messages/inbound` + full HTTP contract → Task 7.
- Auth (`INTERNAL_INGEST_TOKEN`, fail-fast, constant-time) → Tasks 3, 4, 7.
- `providerMessageId` policy → documented in spec; enforced via Zod `min(1)` (Task 1) + no server-side fallback in controller (Task 7).
- Worker handler → Task 8.
- Module structure → Tasks 6, 7 files.
- Structured logging w/ three events → Task 6 (`UNKNOWN_PARENT_CREATED`, `DUPLICATE_MESSAGE_DROPPED`, `ORPHAN_MESSAGE_REENQUEUED`).
- All 9 test cases → 4 in Task 6, 4 in Task 7, 5 in Task 9.
- Error handling table → Tasks 7 (Zod/auth/duplicate) + 6 (Prisma/enqueue) + default NestJS behaviors.
- Doc updates → Task 11.

No gaps found.

**Placeholder scan:** no "TBD", no "implement later", no "similar to Task N". Every code step contains the actual code. Every command has expected output.

**Type consistency:** `IngestResult` discriminated union is defined once in Task 6 and referenced as the return type of `ingest()`. `MESSAGE_INGESTED_JOB` constant name is the same in Tasks 5, 6, 8. `timingSafeEqualStr` is the same identifier in Tasks 3 and 7. `recoverOrphanedMessages()` is defined in Task 6 and called in Task 8. `ParentMessageSchema` / `ParentMessage` are consistent across Tasks 1, 6, 7. No drift.

---

## Execution handoff

Plan complete and saved to [docs/superpowers/plans/2026-04-21-phase-2-message-ingestion.md](./2026-04-21-phase-2-message-ingestion.md).

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
