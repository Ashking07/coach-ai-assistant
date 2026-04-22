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

Backend is deployed to Render at `coach-ai-assistant-backend.onrender.com` (hardcoded in the CORS default). Ensure `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, and `INTERNAL_INGEST_TOKEN` are set in the Render environment — the code relies on env defaults that only make sense locally.
