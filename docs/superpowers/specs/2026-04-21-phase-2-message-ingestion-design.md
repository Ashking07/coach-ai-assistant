# Phase 2 — Message Ingestion Pipeline Design

**Date:** 2026-04-21
**Phase:** 2 (Day 3 of 14)
**Status:** Draft — awaiting user review

## Goal

Build the pre-LLM message pipeline end-to-end: inbound HTTP → validated payload → Message row → BullMQ job → worker loads it → placeholder `AgentDecision` written. No intelligence yet. At the end of this phase, the plumbing is proven — Phase 3 plugs the agent state machine into the worker without touching transport.

## Non-goals

- No intent classification, no Claude calls, no drafting. Those are Phase 3.
- No Twilio webhook wiring yet (separate endpoint arrives in Phase 5). The channel-adapter *pattern* is established here, but the only live caller in Phase 2 is the internal `/api/messages/inbound` route.
- No coach dashboard surfaces. Phase 2's verification is a curl that produces a DB row.

## Principles locked in from `context.md`

- Channel-agnostic core: agent never learns which transport delivered a message.
- Idempotency on webhook-like surfaces is mandatory; duplicates return 200.
- Audit log is append-only; a placeholder decision is still a real row.
- Single-tenant now, multi-tenant-ready: every write carries `coachId = 'demo-coach'`.

## Architecture

```
 caller (curl / webhook / ws)
         │
         ▼
 ┌────────────────────────┐   ┌──────────────────────────────┐
 │ /api/messages/inbound  │   │ /webhooks/twilio (Phase 5)   │
 │ - X-Internal-Token     │   │ - twilio.validateRequest     │
 │ - Zod(ParentMessage)   │   │ - translate → ParentMessage  │
 └────────────┬───────────┘   └──────────────┬───────────────┘
              │                              │
              └──────────────┬───────────────┘
                             ▼
                 MessagesService.ingest(msg)
                 ├─ upsert Parent by (coachId, phone)
                 │    new → isVerified=false, log UNKNOWN_PARENT_CREATED
                 ├─ upsert Message by (channel, providerMessageId)
                 │    duplicate → return { messageId, duplicate: true }, no enqueue
                 └─ enqueue MESSAGE_INGESTED { messageId } on BullMQ
                             │
                             ▼
                  Worker.handleMessageIngested
                  ├─ load Message + Parent
                  └─ insert placeholder AgentDecision
                        intent=NOT_PROCESSED, actionTaken=INGESTED,
                        all LLM fields NULL
```

Three callers, one `ingest()` function. `/webhooks/twilio` is not implemented in Phase 2, but the signature-validation placement and the shape it must produce are specified here so Phase 5 has nothing left to decide.

## Schema changes (one migration: `add_verified_parent_and_nullable_agent_decision`)

**Parent** — gain a verified flag used by Phase 3's policy gate:

```prisma
model Parent {
  // ...existing fields...
  isVerified Boolean @default(false)
}
```

**Intent enum** — gain a sentinel for pre-agent placeholder rows so real classifications can never collide with plumbing rows in audit queries:

```prisma
enum Intent {
  // ...existing values...
  NOT_PROCESSED
}
```

**AgentDecision** — fields that only have meaning after an LLM call become nullable. `actionTaken` stays non-null (always a value, `"INGESTED"` for placeholder):

```prisma
model AgentDecision {
  id          String          @id @default(cuid())
  coachId     String
  messageId   String
  intent      Intent
  actionTaken String
  confidence  Float?          // was: Float
  tier        ConfidenceTier? // was: ConfidenceTier
  reasoning   String?         // was: String
  llmModel    String?         // was: String
  tokensIn    Int?            // was: Int
  tokensOut   Int?            // was: Int
  latencyMs   Int?            // was: Int
  createdAt   DateTime        @default(now())
  // relations unchanged
}
```

**Why this matters (preserved from design discussion):**
- `NOT_PROCESSED` vs reusing `AMBIGUOUS`: `AMBIGUOUS` is a real classification outcome. Collapsing "LLM never ran" and "LLM ran and was unsure" into the same enum value makes the audit log unreadable.
- Nullable LLM fields vs sentinel values (`'none'`, `0`): sentinels poison analytics. `SUM(tokensIn)` over placeholders stays honest at 0 but a `WHERE tokensIn > 0` query silently drops them. Null means "not applicable," which is what's actually true.
- Audit log shows on-screen during the demo; placeholder rows must be visibly different from real decisions.

## Shared Zod schema (`shared` package, created in this phase)

The `shared/` workspace already exists in `pnpm-workspace.yaml` but is an empty directory. Phase 2 creates it as a real pnpm package with one export: the normalized `ParentMessage` schema.

```ts
// shared/src/types/parent-message.ts
import { z } from 'zod';

export const ChannelSchema = z.enum(['SMS', 'WEB_CHAT', 'VOICE']);

export const ParentMessageSchema = z.object({
  coachId: z.string().min(1),
  channel: ChannelSchema,
  fromPhone: z.string().regex(/^\+[1-9]\d{1,14}$/), // E.164
  fromName: z.string().optional(),                  // hint when available
  content: z.string().min(1).max(4000),
  providerMessageId: z.string().min(1),             // idempotency key, per-channel
  receivedAt: z.coerce.date().default(() => new Date()),
});

export type ParentMessage = z.infer<typeof ParentMessageSchema>;
```

Backend imports via `@coach/shared`. The Twilio webhook adapter (Phase 5) validates its output against this same schema before calling `ingest()`. One source of truth, no drift.

## `MessagesService.ingest()`

```ts
// backend/src/modules/messages/messages.service.ts
async ingest(msg: ParentMessage): Promise<{ messageId: string; duplicate: boolean }> {
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

  if (parent.createdAt.getTime() === parent.updatedAt?.getTime() /* fresh */ ) {
    this.logger.log({
      event: 'UNKNOWN_PARENT_CREATED',
      coachId: msg.coachId,
      parentId: parent.id,
      phone: msg.fromPhone,
      channel: msg.channel,
    });
  }

  // Idempotent insert keyed by (channel, providerMessageId).
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
    this.logger.log({ event: 'DUPLICATE_MESSAGE_DROPPED', messageId: existing.id });
    return { messageId: existing.id, duplicate: true };
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

  await this.queue.add('MESSAGE_INGESTED', { messageId: message.id });

  return { messageId: message.id, duplicate: false };
}
```

Notes:
- "Unknown" detection uses `createdAt === updatedAt` as a proxy for "just-created by this upsert." If that proves flaky in practice we switch to `findUnique` + `create` + in-tx flag; keep it simple now.
- BullMQ job name is `'MESSAGE_INGESTED'` — the existing `coach-dev-test-jobs` queue is the transport but job names are per-semantic. Worker dispatches on job name.
- Unknown-parent event goes through NestJS `Logger`, **not** `AgentDecision`. Agent decisions are agent decisions.

## Endpoint: `POST /api/messages/inbound`

```ts
// backend/src/modules/messages/messages.controller.ts
@Controller('api/messages')
export class MessagesController {
  @Post('inbound')
  @HttpCode(200) // 200 on duplicate too — never make a retrying producer retry harder
  async inbound(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    if (!token || token !== process.env.INTERNAL_API_TOKEN) {
      throw new UnauthorizedException();
    }
    const parsed = ParentMessageSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ issues: parsed.error.issues });
    }
    return this.messagesService.ingest(parsed.data);
  }
}
```

- Auth: single `X-Internal-Token` header compared constant-time-ish against `process.env.INTERNAL_API_TOKEN`. Missing or wrong → 401. This endpoint is never publicly meant to be reachable without that token; web chat's WebSocket handler (Phase 5) will set the header server-side, not from the browser.
- Always 200 on success (fresh or duplicate). Zod failure → 400 with issues (only legitimate client error; nothing retries a 400). Auth failure → 401.
- Controller is paper-thin: auth, validate, delegate.

## Worker handler

```ts
// backend/src/worker.ts — extend the existing startWorker()
if (job.name === 'MESSAGE_INGESTED') {
  const { messageId } = z.object({ messageId: z.string() }).parse(job.data);
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
      // confidence, tier, reasoning, llmModel, tokensIn, tokensOut, latencyMs all null
    },
  });

  await prisma.message.update({
    where: { id: message.id },
    data: { processedAt: new Date() },
  });
  return { ok: true };
}
```

- The existing `DEV_TEST_QUEUE` is reused as transport (it's the one queue in the project). Job names differentiate work. The old `'hello'` smoke handler stays in place so `/dev/test-job` still works locally; the new branch handles `MESSAGE_INGESTED`.
- Worker writes `processedAt` so the Message table tells you at a glance which messages have been acked through the pipeline.
- No retries configured yet — Phase 2 is happy-path only. Retry/backoff policy lives in Phase 3 when the LLM can actually fail.

## Module structure (new files)

```
backend/src/modules/messages/
  messages.module.ts      — registers controller + service
  messages.controller.ts  — POST /api/messages/inbound
  messages.service.ts     — ingest()
  messages.service.spec.ts — unit tests (mocked Prisma + queue)
backend/src/modules/messages/dto/
  parent-message.dto.ts   — re-exports the shared Zod schema for convenience
shared/
  package.json            — { "name": "@coach/shared", "main": "src/index.ts" }
  tsconfig.json
  src/index.ts
  src/types/parent-message.ts
```

`AppModule` imports `MessagesModule`. The existing `AppController` keeps its `/dev/test-job` route; `/api/messages/inbound` lives in the new module.

## Tests

**Unit — `messages.service.spec.ts`** (mocked Prisma + queue):
- fresh phone → upsert creates Parent (isVerified=false), inserts Message, enqueues job, logs `UNKNOWN_PARENT_CREATED`.
- known phone (seed coach `demo-coach` + seeded parent) → reuses Parent, no unknown-parent log, enqueues job.
- duplicate `(channel, providerMessageId)` → returns `duplicate: true`, does NOT enqueue, logs `DUPLICATE_MESSAGE_DROPPED`.

**Integration — `messages.e2e-spec.ts`** against local Docker Postgres + real Redis:
- curl the endpoint with a valid token and a fresh providerMessageId.
- Poll (with timeout, max ~2s) until `AgentDecision` row exists for the returned messageId.
- Assert: row has `intent='NOT_PROCESSED'`, `actionTaken='INGESTED'`, all nullable fields are `null`, `message.processedAt` is set.
- Auth: same endpoint with bad token → 401.
- Dupe: second curl with identical providerMessageId → 200, same messageId, no second `AgentDecision`.

## Error handling

| Failure | Response | Side effect |
|---|---|---|
| Missing/wrong `X-Internal-Token` | 401 | Nothing written |
| Zod fails | 400 with `issues` | Nothing written |
| Duplicate `(channel, providerMessageId)` | 200 with `duplicate: true` | No enqueue, no new Message |
| Prisma write fails | 500 | Propagated — caller retries; idempotency guards against double-insert |
| Worker handler throws | BullMQ `failed` event | Job moves to failed queue; no AgentDecision row (honest state) |

## Documentation updates (in the same PR)

**`context.md`:**
- Phase 2 bullet — replace "Twilio-shaped" with "normalized `ParentMessage` JSON (Zod validated, schema in `@coach/shared`)".
- Data Model section — note `Parent.isVerified` and the nullable fields on `AgentDecision`, and add `NOT_PROCESSED` to the Intent list.

**`CLAUDE.md`:**
- Under "Common backend commands", add: `pnpm test:e2e -- messages` for the Phase 2 integration test.
- Add `INTERNAL_API_TOKEN` to the env-var list.

## Open implementation details (resolve during writing-plans)

- `@coach/shared` TS project references vs. path aliases — needs a small call for Jest/ts-node compatibility.
- Exact BullMQ retry/backoff config for `MESSAGE_INGESTED` — leaving as default for Phase 2, revisit in Phase 3.

---

## Self-review

- Placeholders: none; every section has concrete field names, file paths, and HTTP semantics.
- Contradiction check: endpoint returns 200 on duplicates → consistent with "never non-200 on retryable paths"; 400 on Zod fail is non-retryable, consistent.
- Scope: single day's work, one migration, one new module, one new workspace package. Does not cross into Phase 3 (no LLM, no guardrails) or Phase 5 (no Twilio route).
- Ambiguity check: "unknown-parent" detection via `createdAt === updatedAt` is explicitly called out as best-effort with a stated fallback. `actionTaken='INGESTED'` is a string (not enum) by design — future non-LLM actions can use other short uppercase strings without a migration.
