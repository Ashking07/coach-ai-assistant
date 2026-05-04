# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An agentic attention-management system for elite solo coaches. Parents interact via SMS (or web chat in demo); coach gets a dashboard. Built with NestJS + BullMQ + Claude (Sonnet 4.6 drafting, Haiku 4.5 classification) + Prisma + Neon Postgres.

## Workspace layout

pnpm workspace with three packages declared in `pnpm-workspace.yaml`: `frontend`, `backend`, `shared`. The `shared` package (`@coach/shared`) contains the `ParentMessageSchema` Zod schema used by both the inbound endpoint and future channel adapters. Run `pnpm install` at the repo root — per-package installs are not the usual path.

## Local infrastructure

`docker-compose.yml` at the repo root runs Postgres and Redis for local dev. Host ports are **not** the defaults:

- Postgres: host `5433` → container `5432` (user/password/db = `coach`/`coach`/`coach_local`)
- Redis: host `6380` → container `6379`

Code defaults match these non-standard ports. `backend/src/bullmq.constants.ts` defaults `REDIS_URL` to `redis://localhost:6380`, and `backend/.env` sets `DATABASE_URL` to port `5433`. If you change the compose ports, update both places.

## Backend (`backend/`)

NestJS 11 + Prisma 7 (pg adapter) + BullMQ 5. Two entrypoints share the same `AppModule`:

- **Web** — `src/main.ts`, started by `nest start` (script: `pnpm start:dev`). Listens on `process.env.PORT ?? 3002` (not 3000). CORS allowlist is comma-separated via `CORS_ORIGIN`; default includes `localhost:5173`, `localhost:5174`, and the Render URL.
- **Worker** — `src/worker.ts`, started by `nest start --entryFile worker` (script: `pnpm start:worker:dev`). Bootstraps `AppModule` via `createApplicationContext` (no HTTP) and then constructs a BullMQ `Worker` against the same Redis connection. Because it loads the full `AppModule`, the worker also opens a Queue connection and a Prisma client — Postgres must be up even though the worker logic doesn't use it.

The web and worker agree on queue identity through `DEV_TEST_QUEUE = 'coach-dev-test-jobs'` in `bullmq.constants.ts`. The worker allows `BULLMQ_QUEUE_NAME` to override; if you set it, set it on both sides or jobs will silently not be consumed.

`PrismaService` (`src/prisma.service.ts`) extends `PrismaClient` using `@prisma/adapter-pg` with its own `pg.Pool` — it throws at construction if `DATABASE_URL` is unset. It is registered in `MessagesModule` (not `AppModule`) so that `MessagesService` can inject it.

`BullMqModule` (`src/bullmq.module.ts`) is `@Global()` and exports the Queue via a symbol token `TEST_JOB_QUEUE`. Controllers inject it with `@Inject(TEST_JOB_QUEUE)`.

`MessagesController` (`src/modules/messages/messages.controller.ts`) owns `POST /api/messages/inbound`. It validates the shared `ParentMessageSchema`, requires `INTERNAL_INGEST_TOKEN` via `x-internal-token`, and delegates persistence/enqueueing to `MessagesService`.

`MessagesService` is the single writer for inbound parent messages. It creates or reuses parents, deduplicates by `(channel, providerMessageId)`, writes `Message`, enqueues `MESSAGE_INGESTED`, and provides boot-time recovery for orphaned inbound messages.

`worker.ts` handles `MESSAGE_INGESTED` jobs in a separate process and calls back into `MessagesService` to write the placeholder `AgentDecision` and mark the message processed. It also runs orphan recovery on startup.

### Agent side-effects on draft approval

The drafter (`modules/agent/states/draft-reply.state.ts`) returns optional structured fields alongside the reply text — currently `bookedSlotIso` (BOOK confirmations) and `cancelSessionId` (CANCEL confirmations). Each is the prompt-side handle for a session-state mutation that should run when the reply actually goes out. The pattern is:

1. Drafter is given `availableSlots` and `upcomingSessions` from `AgentContext`, both rendered with their primary keys (`[iso: ...]` and `[id: ...]`) so the model can quote them verbatim.
2. Drafter's `DraftReplySchema` accepts the matching field; `DRAFT_SYSTEM_PROMPT` instructs the model when to populate it.
3. On the auto-send path, `OutboundService.autoSend` performs the mutation immediately after the channel sender succeeds.
4. On the queue path, the field is persisted on the `ApprovalQueue` row (`cancelSessionId` column added by migration `20260504050622_add_cancel_session_to_approval`); `DashboardService.sendApproval` re-reads it after dispatch and runs the same mutation.

For CANCEL specifically, the mutation is gated by ownership: the session must belong to the parent's kid (`kid.parentId === parentId`) and be on the same coach. If the model picks a session ID the parent doesn't own, the mutation is skipped and an `APPROVAL_CANCEL_SESSION_NOT_OWNED` log is emitted — the draft still goes out so we don't strand the parent waiting for a confirmation.

To add a new structured action (e.g. `rescheduleSessionId` + `rescheduleToIso`):
- Extend `DraftReplySchema` and `DRAFT_SYSTEM_PROMPT`.
- Plumb the field through `DraftReplyResult`.
- Add a column on `ApprovalQueue`, persist in `OutboundService.queueForApproval`, act on it in `DashboardService.sendApproval`.
- Mirror the immediate mutation in `OutboundService.autoSend` for the auto-confidence path.

### Messaging channels

Inbound webhooks live in `modules/twilio/twilio.controller.ts` (POST `/api/twilio/inbound`) and `modules/telnyx/telnyx.controller.ts` (POST `/api/telnyx/inbound`). Both ingest via `MessagesService` with `channel: 'SMS'`. The `Channel` Prisma enum is `SMS | WEB_CHAT | VOICE` only — there is no `WHATSAPP` value. WhatsApp messages are stored as `SMS`.

Outbound replies are dispatched by `ChannelSenderRegistry` (`modules/agent/channels/channel-sender.registry.ts`), keyed by `Channel`. The registry is built in `channel-sender.module.ts`, which currently wires:

- `TwilioWhatsAppSender` → `Channel.SMS` (active for the demo — sends via Twilio WhatsApp sandbox)
- `WebChatSender` → `Channel.WEB_CHAT`

Only **one sender per channel** is allowed (the registry is a `Map<Channel, ChannelSender>`). Idle senders kept in the tree but not registered:

- `TelnyxSmsSender` (`modules/agent/channels/telnyx-sms.sender.ts`) — real-SMS path via Telnyx +16573911271
- `TwilioSmsSender` (`modules/agent/channels/twilio-sms.sender.ts`) — generic Twilio SMS path (uses `TWILIO_PHONE_NUMBER`, no `whatsapp:` prefix)

To switch the active SMS-channel sender, edit the `useFactory` and `inject` arrays in `channel-sender.module.ts`. There is no per-parent dispatch — every reply on `Channel.SMS` goes through whichever sender is registered.

#### Twilio WhatsApp sandbox (demo path)

`TwilioWhatsAppSender` (`modules/agent/channels/twilio-whatsapp.sender.ts`) sends with `whatsapp:` prefix on both `to` and `from`. The `from` address is read from `TWILIO_WHATSAPP_FROM` (default `whatsapp:+14155238886`, the shared Twilio sandbox).

Inbound: Twilio webhooks set `From=whatsapp:+E164`. `TwilioInboundSchema` (`modules/twilio/dto/twilio-inbound.dto.ts`) strips the `whatsapp:` prefix via a Zod transform before E.164 regex validation, so the parent's `phone` is stored clean. The `TwilioSignatureGuard` validates the signature using the raw form params (with prefix intact) before the DTO transform runs.

Sandbox onboarding for parents: each test phone must send `join dirt-iron` to `+1 415 523 8886` from WhatsApp before the bot will see them or be able to reply.

To swap back to real SMS via Telnyx (e.g. for production after WhatsApp Business approval), revert `channel-sender.module.ts` to register `TelnyxSmsSender`.

### Common backend commands

```bash
# from backend/
pnpm start:dev              # web server, watch mode, port 3002
pnpm start:worker:dev       # worker, watch mode
pnpm build                  # nest build → dist/
pnpm start:prod             # node dist/src/main.js
pnpm start:worker           # node dist/src/worker.js
pnpm lint                   # eslint --fix
pnpm test                   # jest (unit, *.spec.ts under src/)
pnpm test -- app.controller # run a single test file by name pattern
pnpm test:e2e               # jest with test/jest-e2e.json
pnpm test:e2e -- messages   # Phase 2 ingestion integration test (requires real DB + Redis)
pnpm test:cov               # jest --coverage
```

Prisma uses `prisma.config.ts` (new-style config; `.env` is loaded via `dotenv/config` there — the default Prisma auto-load does not apply). Typical flow: `pnpm prisma migrate dev`, `pnpm prisma generate`.

`INTERNAL_INGEST_TOKEN` — secret for `POST /api/messages/inbound`. Must be ≥16 chars; app crashes on boot if missing. Guards the endpoint with a constant-time comparison (`timingSafeEqualStr`).

`ANTHROPIC_API_KEY` — required for Phase 3+ classification/drafting states. App crashes on boot if missing due to env validation fail-fast.

### Dev smoke test

With docker compose up and both web + worker running:

```bash
curl -X POST http://localhost:3002/dev/test-job -H 'Content-Type: application/json' -d '{"message":"hello"}'
```

Worker should log `Received: hello` then `Completed job <id> from coach-dev-test-jobs`. `docker compose exec redis redis-cli KEYS '*bull*'` should show `bull:coach-dev-test-jobs:*` keys.

## Frontend (`frontend/`)

Vite 8 + React 19 + TypeScript + Tailwind 4 (`@tailwindcss/vite`) + TanStack Query + Zustand + React Router 7. UI components under `src/components/ui/` follow a shadcn-style pattern (`components.json` present). The backend URL comes from `VITE_API_URL` at build time (`App.tsx`).

```bash
# from frontend/
pnpm dev        # vite dev server (default 5173)
pnpm build      # tsc -b && vite build
pnpm lint       # eslint .
pnpm preview    # preview the production build
```

No test runner is configured on the frontend.

## Deployment notes

Backend is deployed to Render at `coach-ai-assistant-backend.onrender.com` (hardcoded in the CORS default). Ensure `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `INTERNAL_INGEST_TOKEN`, `ANTHROPIC_API_KEY`, and (for the WhatsApp demo path) `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` are set in the Render environment — the code relies on env defaults that only make sense locally.

The Twilio sandbox webhook (Twilio Console → WhatsApp → Sandbox settings → "When a message comes in") must point to `https://coach-ai-assistant-backend.onrender.com/api/twilio/inbound`.
