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

## Invariants (enforceable by code review)

These must hold after Phase 2 and for every phase after:

1. **`MessagesService.ingest()` is the only writer of the `Message` table.** No controller, webhook handler, worker, test fixture (outside seed), or ad-hoc script inserts into `Message` directly. CI/code review rejects any `prisma.message.create(...)` or `prisma.message.upsert(...)` outside `messages.service.ts`.
2. **`MessagesService.ingest()` is the only producer that enqueues `MESSAGE_INGESTED`.** Other job names can be produced elsewhere, but this one is owned by the service.
3. **`AgentDecision` is written only by the worker (Phase 2) or agent state machine (Phase 3+).** Never by controllers.
4. **`AgentDecision` rows are inserted only — never updated, never deleted.** (Already in `context.md`; restated for enforcement.)

If any of these change, they change *in the spec first* and then in the code.

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

**File:** `backend/src/modules/messages/messages.service.ts`

**Signature:**

```ts
export type IngestResult =
  | { messageId: string; duplicate: false; enqueued: true;  jobId: string }
  | { messageId: string; duplicate: true;  enqueued: false; jobId: null   };

async ingest(msg: ParentMessage): Promise<IngestResult>
```

- Returns a discriminated union so callers can log/respond correctly without an extra DB read.
- `jobId` is the BullMQ job id (string, opaque to caller) so `/webhooks/twilio` can correlate.
- The controller MAY omit `jobId` from its HTTP response body, but the service return includes it.

**Body:**

```ts
// backend/src/modules/messages/messages.service.ts
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
    this.logger.log(
      { event: 'UNKNOWN_PARENT_CREATED', coachId: msg.coachId, parentId: parent.id, phone: msg.fromPhone, channel: msg.channel },
      MessagesService.name,
    );
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
    this.logger.log(
      { event: 'DUPLICATE_MESSAGE_DROPPED', messageId: existing.id, channel: msg.channel, providerMessageId: msg.providerMessageId },
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

  // Enqueue AFTER commit. See "Atomicity and recovery" — an enqueue failure leaves an
  // orphaned Message row that the boot-time recovery sweep re-enqueues.
  const job = await this.queue.add('MESSAGE_INGESTED', { messageId: message.id });

  return { messageId: message.id, duplicate: false, enqueued: true, jobId: String(job.id) };
}
```

Notes:
- "Unknown" detection uses `createdAt === updatedAt` as a proxy for "just-created by this upsert." If that proves flaky in practice we switch to `findUnique` + `create` + in-tx flag; keep it simple now.
- BullMQ job name is `'MESSAGE_INGESTED'` — the existing `coach-dev-test-jobs` queue is the transport but job names are per-semantic. Worker dispatches on job name.
- Unknown-parent event goes through NestJS `Logger`, **not** `AgentDecision`. Agent decisions are agent decisions.

## Atomicity and recovery

The DB write and the Redis enqueue cannot be atomic (two systems, no distributed tx). We accept this inconsistency with an explicit recovery path rather than pretending it away:

- **Ordering:** DB `create()` first, `queue.add()` second. A crash between them leaves a `Message` row with no `AgentDecision` — recoverable. The reverse order could leave a ghost job pointing at a nonexistent message id — not recoverable.
- **Recovery sweep:** On worker boot, run `MessagesService.recoverOrphanedMessages()`. It selects recent `Message` rows that have no matching `AgentDecision` and re-enqueues `MESSAGE_INGESTED` for each. Idempotency of the worker handler (itself a `findOrCreate` on AgentDecision per messageId) makes double-enqueue safe.
- **Window:** sweep looks back 24 hours. A Phase 2 bug older than that is a bigger problem than a missed message.
- **Idempotent worker handler:** before inserting `AgentDecision`, the handler checks `agentDecision.findFirst({ where: { messageId } })`. If one exists, it's a re-enqueue — skip and return `{ ok: true }`.

The recovery sweep is a function — not a cron. It runs once at worker boot. This is adequate for a 2-week demo; a proper nightly cron can be added in Phase 7 along with VeriOps.

## Endpoint: `POST /api/messages/inbound`

**File:** `backend/src/modules/messages/messages.controller.ts`

```ts
@Controller('api/messages')
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly config: ConfigService,
  ) {}

  @Post('inbound')
  @HttpCode(200) // 200 on duplicate too — never make a retrying producer retry harder
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
      // 422 — the body is syntactically valid JSON but semantically invalid per schema.
      // (400 is reserved for unparseable bodies, which NestJS's body parser raises on its own.)
      throw new UnprocessableEntityException({ issues: parsed.error.issues });
    }
    const result = await this.messagesService.ingest(parsed.data);
    return { messageId: result.messageId, duplicate: result.duplicate };
  }
}
```

### HTTP contract

| Scenario | Status | Body |
|---|---|---|
| Fresh message accepted | 200 | `{ "messageId": "...", "duplicate": false }` |
| Duplicate `(channel, providerMessageId)` | 200 | `{ "messageId": "...", "duplicate": true }` |
| Missing `X-Internal-Token` header | 401 | `{ "statusCode": 401, "message": "Unauthorized" }` |
| Wrong `X-Internal-Token` value | 401 | same as above |
| Malformed JSON (body parser failure) | 400 | NestJS default error body |
| JSON valid, Zod rejects | 422 | `{ "statusCode": 422, "message": "...", "issues": [...] }` |
| Unexpected server error (Prisma/Redis down) | 500 | NestJS default error body |

### Auth details

- Env var: **`INTERNAL_INGEST_TOKEN`** (loaded via `@nestjs/config` `ConfigService`).
- **Fail-fast:** `AppModule` validates `INTERNAL_INGEST_TOKEN` is set at bootstrap via `ConfigModule.forRoot({ validate: ... })`. If missing → process exits on boot. **No silent auth-disabled mode.** A forgotten Render env var must crash the deploy, not produce an open endpoint.
- Comparison uses a constant-time helper (`timingSafeEqualStr`, thin wrapper over `crypto.timingSafeEqual`) to avoid timing attacks. Cheap and correct.
- The only callers that should know this token: (a) curl during dev, (b) web chat WebSocket handler (Phase 5) which sets the header server-side from its own env, (c) CI/e2e tests.
- **Twilio webhook does NOT use this header.** `/webhooks/twilio` authenticates via Twilio signature validation (separate concern, Phase 5 scope).

### Rotation

To rotate the token: update on Render → redeploy. No in-code rotation path in Phase 2. (Can add dual-secret support in Phase 7 if needed.)

## `providerMessageId` policy (per channel)

The unique constraint `(channel, providerMessageId)` is the idempotency key. Its value depends on the transport:

| Channel | Source of `providerMessageId` | Idempotency real? |
|---|---|---|
| `SMS` (Twilio) | Twilio's `MessageSid` (e.g. `SM1a2b...`), set by the Phase 5 webhook adapter. | Yes — Twilio guarantees stable IDs across retries. |
| `WEB_CHAT` | Client-generated UUIDv4, set in the browser before send. Server rejects missing/short values via Zod. | Yes for duplicate submits (double-click, network retry). Not for an adversarial client — web chat is internal-auth'd behind the token, so this is acceptable. |
| `VOICE` (Phase 6) | Gemini Live session id + utterance counter, e.g. `gemini:<sessionId>:<n>`. Out of Phase 2 scope; recorded here so we don't repaint later. | Yes. |

Explicit decision: we do NOT fall back to server-generated UUIDs for `WEB_CHAT`. Doing so makes every message look "fresh" and silently disables idempotency, which is exactly the bug context.md warns against for Twilio-style retries. The web-chat client's job is to generate an id once per send and retry with the same id if the connection flaps.

## Worker handler

```ts
// backend/src/worker.ts — extend the existing startWorker()
if (job.name === 'MESSAGE_INGESTED') {
  const { messageId } = z.object({ messageId: z.string() }).parse(job.data);

  // Re-enqueue safety (see Atomicity and recovery): bail if we already wrote a decision.
  const existingDecision = await prisma.agentDecision.findFirst({
    where: { messageId },
    select: { id: true },
  });
  if (existingDecision) {
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
- Existing-decision check makes the handler idempotent so the boot-time recovery sweep can safely re-enqueue.

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

## Structured logging

Both the service and worker use NestJS's built-in `Logger` with structured metadata (object first, context string second). This is compatible with Phase 7's VeriOps ingestion without rewiring:

```ts
// ✔ good
this.logger.log(
  { event: 'UNKNOWN_PARENT_CREATED', coachId, parentId, phone, channel },
  MessagesService.name,
);
this.logger.warn(
  { event: 'DUPLICATE_MESSAGE_DROPPED', messageId, channel, providerMessageId },
  MessagesService.name,
);

// ✘ bad — loses structure, unusable for VeriOps
this.logger.log(`Unknown parent created: ${phone}`);
```

Every log from the messages pipeline includes an `event` string in SCREAMING_SNAKE_CASE. This becomes the stable event name we filter on in Phase 7.

**Events defined in Phase 2:**
- `UNKNOWN_PARENT_CREATED` — `{ coachId, parentId, phone, channel }`
- `DUPLICATE_MESSAGE_DROPPED` — `{ messageId, channel, providerMessageId }`
- `ORPHAN_MESSAGE_REENQUEUED` — `{ messageId, ageSeconds }` (from recovery sweep)

## Tests

### Unit — `backend/src/modules/messages/messages.service.spec.ts`

Mocked Prisma (via Nest testing module) and a mocked BullMQ `Queue`. No DB, no Redis.

1. **fresh phone creates unverified Parent and enqueues.** Asserts: `parent.upsert` called, `message.create` called with expected args, `queue.add('MESSAGE_INGESTED', { messageId })` called once, logger called with `event: 'UNKNOWN_PARENT_CREATED'`. Return value is `{ duplicate: false, enqueued: true, jobId: '...' }`.
2. **known phone reuses Parent, no unknown-parent log.**
3. **duplicate returns early, no enqueue.** Asserts return is `{ duplicate: true, enqueued: false, jobId: null }` and `queue.add` was NOT called. Logger called with `event: 'DUPLICATE_MESSAGE_DROPPED'`.
4. **DB commits before enqueue.** Arrange `queue.add` to reject; assert `message.create` still committed (atomicity spec).

### Unit — `backend/src/modules/messages/messages.controller.spec.ts`

1. **missing token → 401.**
2. **wrong token → 401.** (Also proves we compare both lengths; helper handles short-circuit.)
3. **valid token + malformed body → 422 with `issues`.**
4. **valid token + good body → delegates to service, returns `{ messageId, duplicate }`.** (Service mocked.)

### Integration — `backend/test/messages.e2e-spec.ts`

Uses the real NestJS app, local Docker Postgres, and local Redis. Worker bootstrapped inline (matches production topology).

1. **happy path.** POST a fresh payload → 200 with `{ messageId, duplicate: false }`. Poll (≤2s) until `AgentDecision` row exists. Assert: `intent='NOT_PROCESSED'`, `actionTaken='INGESTED'`, `confidence/tier/reasoning/llmModel/tokensIn/tokensOut/latencyMs` all `null`, `Message.processedAt` is set within last 2s.
2. **auth.** Same POST with bad token → 401. No DB writes.
3. **idempotency.** POST the same payload twice → both 200, same `messageId`, exactly one `AgentDecision` row.
4. **unknown parent.** POST with a phone not in seed data → Parent row created with `isVerified=false` and name `Unknown (+...)`.
5. **recovery sweep.** Pre-insert a `Message` row directly in the DB (bypassing ingest) with no `AgentDecision`, restart the worker, assert an `AgentDecision` appears within 2s. *This is the only test allowed to bypass `ingest()` — it explicitly simulates a pre-recovery orphan.*

Running: `pnpm --filter backend test` for units, `pnpm --filter backend test:e2e -- messages` for integration.

## Error handling

| Failure | Response | Side effect |
|---|---|---|
| Missing/wrong `X-Internal-Token` | 401 | Nothing written |
| Malformed JSON | 400 (NestJS default) | Nothing written |
| Zod rejects body | 422 with `issues` | Nothing written |
| Duplicate `(channel, providerMessageId)` | 200 with `duplicate: true` | No enqueue, no new Message |
| Prisma write fails | 500 | Propagated — caller retries; idempotency guards against double-insert |
| BullMQ enqueue fails after DB commit | 500 | Orphan Message row; boot-time recovery sweep re-enqueues |
| Worker handler throws | BullMQ `failed` event | Job in failed queue; no AgentDecision row (honest state) |

## Documentation updates (in the same PR)

**`context.md`:**
- Phase 2 bullet — replace "Twilio-shaped" with "normalized `ParentMessage` JSON (Zod validated, schema in `@coach/shared`)".
- Data Model section — add `Parent.isVerified`, mark the nullable fields on `AgentDecision`, and add `NOT_PROCESSED` to the Intent list.

**`CLAUDE.md`:**
- Under "Common backend commands", add: `pnpm test:e2e -- messages` for the Phase 2 integration test.
- Add `INTERNAL_INGEST_TOKEN` to the env-var list.

## Open implementation details (resolve during writing-plans)

- `@coach/shared` TS project references vs. path aliases — needs a small call for Jest/ts-node compatibility.
- Exact BullMQ retry/backoff config for `MESSAGE_INGESTED` — leaving as default for Phase 2, revisit in Phase 3.

---

## Self-review (second pass, after checklist review)

- **Single choke point:** confirmed. Only `MessagesService.ingest()` writes `Message` or enqueues `MESSAGE_INGESTED`. Stated as Invariant #1–2 at top of spec. Integration test #5 is the only allowed exception (bypasses to seed a recovery scenario) and is explicitly marked.
- **Return contract:** `ingest()` returns a discriminated union `IngestResult`; controller narrows to `{ messageId, duplicate }` for HTTP response. No ambiguity.
- **Atomicity:** DB write → enqueue ordering is explicit. Recovery sweep + idempotent worker handler handle the gap. Orphan window is 24h.
- **Error codes:** full table present. 400 vs 422 distinction made (malformed JSON vs schema violation).
- **Auth:** `INTERNAL_INGEST_TOKEN` via `ConfigService.getOrThrow`, boot-time validation, constant-time compare, no silent-disabled mode.
- **Idempotency window:** `providerMessageId` source pinned per channel. Web-chat must generate UUID client-side — explicitly forbidden to fall back server-side.
- **Logger:** NestJS `Logger` with `{ event, ... }` first arg, class name as context. Three Phase-2 events named.
- **Tests:** 9 concrete cases across unit + e2e, each with expected inputs and expected assertions.
- **File paths + signatures:** every component has an explicit path and typed signature in this spec.
- **Prisma diff:** shown in prose + Prisma snippets. Migration file name specified. Actual SQL will be generated by `prisma migrate dev --name add_verified_parent_and_nullable_agent_decision` during implementation.
