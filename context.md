# CONTEXT.md

> **Handoff document for AI coding assistants (Claude Code, Codex, Cursor, etc.)**
> Read this before making any changes. Everything else in the repo assumes you've internalized this.

---

## What this project is

An **agentic attention-management system for elite solo coaches**. Specifically: an Olympic-level kids' coach who charges $200/session, manages ~50 parents with pen and paper, and loses hours a week to admin — confirming sessions, answering logistics questions, chasing payments, writing session notes.

The product is not a booking app. Booking apps exist (Calendly, Paperbell, Acuity). The real problem is the **cognitive overhead of parent communication** that fragments the coach's attention. The system's job is to absorb that overhead: handle routine messaging autonomously, surface only what truly needs the coach's decision.

### Thesis (taped to the monitor)
> An agentic attention-management system for elite solo coaches — handling routine parent communication transparently and surfacing only what genuinely needs the coach's decision.

### Two mirrored users, two mirrored pains
- **Coach's pain:** admin eats the focus needed for coaching
- **Parent's pain:** uncertainty — not knowing if a message was seen, lost logistics, payment awkwardness, no session context

The product addresses both.

### This is a class project with real stakes
Built for a Software Architecture class at CSU Fullerton (CPSC-597). Graded by Prof. Metin Kaplan, Senior Director & Head of Business at Siemens Digital Industries Software. Whoever ships the best app wins a Siemens internship. Metin's own son takes coaching, so he's also a parent-user of the problem. Timeline: 2 weeks from project start to in-class demo.

### What "winning the demo" means (project North Star)
Kaplan is a business-technical VP at Siemens (industrial software, PLM/CAD). He values:
- **User empathy** — built for a real person, not an imagined one
- **Clean architecture** — explainable, auditable, defensible decisions
- **Controlled agentic behavior** — AI does narrow things well, code does the rest
- **Business viability** — honest unit economics, not hype

Every design decision should ladder up to: *"This student thinks like a product engineer who'd ship production systems at Siemens."*

---

## Product principles (these override features)

1. **Protect the coach's attention.** If a feature spends his attention, it must be buying something important.
2. **Eliminate parent uncertainty.** Every parent message gets acknowledged within seconds, even when the coach is mid-session.
3. **AI does narrow things well.** The LLM classifies, extracts, drafts. Everything else — availability logic, routing, policy, state — is deterministic code.
4. **Every agent action is tiered.** Auto-send / draft-and-approve / escalate-to-coach. No ungated autonomous actions on anything financial, sensitive, or ambiguous.
5. **Every agent action is logged.** The audit log is a feature, not debug output. It's shown in the demo.
6. **Channel-agnostic.** The agent core doesn't know or care whether a message arrived via SMS, web chat, or WhatsApp. Transport is abstracted.
7. **Nothing gets hallucinated to parents.** When uncertain, the agent says "let me check with coach" and escalates. Never fabricates an answer.

---

## Architecture (must not drift)

### High-level flow

```
Parent (SMS / Web Chat)
      ↓
Channel Adapter (normalizes to common ParentMessage shape)
      ↓
POST /api/messages/inbound → validates, writes to DB, enqueues
      ↓
BullMQ Queue (Redis)
      ↓
Worker process pulls job
      ↓
Agent State Machine
   ├─ CLASSIFY_INTENT (Haiku 4.5)
   ├─ LOAD_CONTEXT (Postgres + Redis cache)
   ├─ ROUTE_BY_INTENT
   │     ├─ BOOK_FLOW → check availability → draft reply → gate
   │     ├─ RESCHEDULE_FLOW → ...
   │     ├─ QUESTION_FLOW → FAQ lookup → draft reply → gate
   │     └─ ESCALATE_FLOW → notify coach, hold
   ├─ DRAFT_REPLY (Sonnet 4.6)
   ├─ CONFIDENCE_GATE + POLICY_GATE
   │     ├─ AUTO → send via channel adapter
   │     ├─ APPROVE → queue for coach review, notify
   │     └─ ESCALATE → flag, notify coach, no auto-send
   └─ AUDIT_LOG (every transition, append-only)
              ↓
      SSE push to Coach Dashboard (real-time)
              ↓
      Fire-and-forget event to VeriOps (observability)
```

### Non-negotiables
- **Hand-rolled state machine, not LangGraph, not LLM-choose-its-own-adventure.** States are typed Python/TS classes. LLM is called at specific states for specific narrow tasks only.
- **LLM client is abstracted.** A thin `LLMClient` class wraps Anthropic SDK. Swappable via config. States depend on the abstraction, not the SDK.
- **Guardrails are code, not prompts.** Policy gate is a deterministic rule engine (`PolicyGate` class). Never rely on prompting an LLM to "not do X" — it will do X eventually.
- **Audit log is append-only.** The `AgentDecision` table never updates or deletes rows. Treat as event log.
- **Single-tenant now, multi-tenant-ready schema.** Every table has `coachId` from day one even though we hardcode a single coach. Do not skip this.

### Tier definitions (authoritative)

| Tier | Meaning | Examples |
|---|---|---|
| **AUTO** | Agent sends without coach involvement | Booking confirmations for known parents, FAQ answers from approved KB, session reminders, logistics questions (time/location/what to bring) |
| **APPROVE** | Agent drafts, coach taps to send | Reschedules, non-standard replies, sensitive tone, first-time inquiries from new parents |
| **ESCALATE** | Agent does NOT draft, flags only | Price/rate discussions, complaints, anything mentioning money changes, safety concerns, medical mentions, ambiguous or out-of-scope messages, profanity, unknown sender |

**Hard rules (policy gate always rejects, never overridable by LLM):**
- Never agree to rate changes
- Never confirm a booking with a new parent without coach approval
- Never discuss another kid with a different parent
- Never mention medical advice
- Never commit to makeups/refunds without coach approval

---

## Tech stack (locked)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React SPA + Vite + TypeScript | No SEO need, internal tool, fast dev loop |
| Styling | Tailwind CSS v4 + shadcn/ui | Polished aesthetic without custom CSS |
| Frontend state | TanStack Query (server state) + Zustand (UI state) | Standard, lightweight |
| Real-time | SSE from NestJS → React | Simpler than WebSockets for one-way push |
| Backend | NestJS + TypeScript | Structured, DI, pairs with developer's MERN background |
| Queue | BullMQ on Redis | De facto Node queue, good observability |
| Worker | Separate process, same codebase | NestFactory.createApplicationContext() entrypoint |
| ORM | Prisma | Best DX, good NestJS integration |
| Database (prod) | Neon Postgres | Serverless, branching, free tier |
| Database (local) | Postgres via Docker Compose | Instant, no network, matches production |
| Cache | Redis (local Docker, Render Redis in prod) | Agent context cache, queue backing store |
| LLM | Anthropic Claude | Best structured output reliability |
| — Classification | Claude Haiku 4.5 | Fast, cheap, accurate for intent |
| — Drafting | Claude Sonnet 4.6 | Natural SMS-appropriate tone |
| SMS | Twilio trial | 1-2 verified numbers for real-SMS demo |
| Web chat | WebSocket via NestJS | Simulates SMS for 20-classmate live demo |
| Voice | Gemini Live | Coach-side voice input (added week 2) |
| Payments | Stripe Payment Links | Agent sends link via SMS; no custom checkout |
| Frontend host | Vercel | Free tier, instant deploys |
| Backend host | Render ($7/mo web + paid Redis) | Developer has prior experience, avoids Railway WS issues |
| Observability | VeriOps (developer's own project) + structured logs | Agent events stream to VeriOps; Postgres audit_log is canonical |
| Local dev | Docker Compose | Matches production, shared across team (future) |
| Package manager | pnpm workspaces | Monorepo: `/frontend`, `/backend`, `/shared` |

### Tech choices deliberately rejected (ask why before changing)
- **LangGraph / LangChain** — wrong abstraction layer, explainability weaker, adds churn risk
- **Pure LLM with tool-calling as orchestrator** — not defensible for this audience
- **Calendly / Cal.com integration** — opposite interaction model (self-serve booking page vs agent-negotiated)
- **AWS for deployment** — setup cost exceeds build budget for 2-week project
- **Fly.io** — free tier removed Oct 2024; now $5+/mo minimum
- **Python backend** — developer is faster in Node; agent work is orchestration-heavy, not ML-heavy
- **Multi-tenant UX on day 1** — schema supports it; UX is single-coach for MVP
- **Voice as primary coach interface** — demo trap; visual dashboard primary, voice augmented
- **WhatsApp for MVP** — Meta Business verification takes weeks; channel adapter supports it as future work

---

## Data model (authoritative)

All tables have `coachId` (single-tenant now, multi-tenant-ready).

```
Coach            — id, name, phone, timezone, stripeAccountId, createdAt
Parent           — id, coachId, name, phone (E.164), preferredChannel, isVerified (Boolean, default false), createdAt
Kid              — id, coachId, parentId, name, age, notes (text), createdAt
Session          — id, coachId, kidId, scheduledAt, durationMinutes, status, paid, paymentMethod, coachNotes, createdAt
Availability     — id, coachId, startAt, endAt, isBlocked, reason, createdAt
Message          — id, coachId, parentId, direction, channel, providerMessageId (unique per channel), content, receivedAt, processedAt
AgentDecision    — id, coachId, messageId, intent, confidence?, tier?, actionTaken, reasoning?, llmModel?, tokensIn?, tokensOut?, latencyMs?, createdAt (append-only)
ApprovalQueue    — id, coachId, messageId, draftReply, status, createdAt, resolvedAt, resolvedBy
```

### Design decisions already made
- Parent-to-kid: one-to-many for MVP (siblings possible, shared parent). Many-to-many deferred.
- Message idempotency: `UNIQUE (channel, providerMessageId)` to handle Twilio retries.
- AgentDecision: append-only event log. Never UPDATE, never DELETE. Nullable LLM fields (confidence, tier, reasoning, llmModel, tokensIn, tokensOut, latencyMs) are null for placeholder rows written before the agent state machine is reached.
- `Intent.NOT_PROCESSED`: sentinel value for pre-agent placeholder rows; never produced by the LLM. Used until Phase 3 wires classification.
- `Parent.isVerified`: false by default for all new parents arriving via inbound message (unknown senders). Set to true when coach manually verifies or when parent is seeded.
- ApprovalQueue expiration: if unresolved after 2 hours, auto-escalate (mark as escalated, notify coach differently). Do not auto-send.
- Session status enum: `PROPOSED | CONFIRMED | COMPLETED | CANCELLED | NO_SHOW`
- Payment method enum: `CASH | STRIPE`
- Preferred channel enum: `SMS | WEB_CHAT`

---

## Repo layout

```
coach-assistant/
├── frontend/                  # React SPA
│   ├── src/
│   │   ├── components/
│   │   ├── features/          # feature-first organization
│   │   ├── lib/
│   │   └── App.tsx
│   ├── .env                   # VITE_API_URL etc.
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── main.ts            # HTTP entrypoint
│   │   ├── worker.ts          # BullMQ worker entrypoint (createApplicationContext)
│   │   ├── modules/
│   │   │   ├── agent/         # state machine, guardrails, LLM client
│   │   │   ├── channels/      # SMS, WebChat adapters
│   │   │   ├── messages/      # inbound/outbound message handling
│   │   │   ├── approvals/     # coach approval queue
│   │   │   ├── audit/         # AgentDecision logging
│   │   │   └── prisma/        # Prisma service
│   │   └── ...
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── .env
│   └── package.json
│
├── shared/                    # Shared TS types (ParentMessage, Intent, Tier, etc.)
│   └── src/
│       └── types/
│
├── docker-compose.yml         # Local Postgres + Redis
├── pnpm-workspace.yaml
├── package.json               # Root scripts
├── CONTEXT.md                 # THIS FILE — authoritative context
├── CLAUDE.md                  # Claude Code quick-start
├── DEMO.md                    # Minute-by-minute demo script
├── PRD.md                     # Full product requirements doc
└── README.md                  # Setup instructions
```

---

## Environment & ports (non-default — pay attention)

| Service | Local port | Notes |
|---|---|---|
| Backend HTTP | **3002** | Not 3000. Developer has other project on 3000. `process.env.PORT ?? 3002` |
| Frontend dev | 5173 | Vite default |
| Postgres (Docker) | **5433** | Not 5432. Non-default to avoid conflict with host Postgres |
| Redis (Docker) | **6380** | Not 6379. Non-default to avoid conflict |

**Env var conventions:**
- Backend reads `REDIS_URL`, `DATABASE_URL`, `DIRECT_URL`, `INTERNAL_INGEST_TOKEN`, `ANTHROPIC_API_KEY`, `TWILIO_*`, `STRIPE_*`, `BULLMQ_QUEUE_NAME`, `PORT`
- Frontend reads `VITE_API_URL` (backend URL)
- Same variable names in local `.env` and Render environment — swap values, not keys
- `.env.example` committed; actual `.env` files are gitignored

---

## Development phases (2-week sprint)

### Current status: end of Day 5 / Phase 3 complete
- ✅ Monorepo scaffolded (pnpm workspaces)
- ✅ Docker Compose for Postgres + Redis
- ✅ NestJS backend scaffolded
- ✅ Prisma initialized with minimal `Coach` model
- ✅ React + Vite + Tailwind + shadcn frontend scaffolded
- ✅ Vercel + Render deployed walking skeleton
- ✅ Separate BullMQ worker entrypoint (NestFactory.createApplicationContext)
- ✅ Smoke test passed: enqueue → Redis → worker consumes → completed
- ✅ Phase 2 — Message ingestion pipeline: inbound HTTP accepts the normalized `ParentMessage` JSON (Zod-validated, schema in `@coach/shared`); `MessagesService.ingest()` is the single choke point that writes `Message` and enqueues `MESSAGE_INGESTED`. Boot-time orphan recovery re-enqueues any inbound messages missing a decision.
- ✅ Phase 3 Day 4 — Intent classification + context loading: `ClassifyIntentState` (Haiku 4.5) + `LoadContextState` (parent/kids/sessions/availableSlots from Postgres).
- ✅ Phase 3 Day 5 — Guardrails + reply drafting + full agent loop:
  - `PolicyGate`: deterministic rule engine — unknown sender, sensitive keywords, ESCALATE intents → always ESCALATE regardless of LLM output
  - `ConfidenceGate`: routes BOOK+verified+high-confidence+slots→AUTO; all other BOOK→APPROVE; QUESTION_LOGISTICS+verified+high-confidence→AUTO; everything else→APPROVE
  - `DraftReplyState`: Sonnet 4.6 drafts a warm professional reply using parent name, kid, intent, and available slot labels
  - `validateDraft`: hallucination backstop — if draft mentions a time not in availableSlots, downgrades AUTO→APPROVE
  - `OutboundService`: three terminal writers — `autoSend` (writes OUTBOUND Message + AUTO_SENT AgentDecision), `queueForApproval` (writes ApprovalQueue + QUEUED_FOR_APPROVAL decision), `escalate` (writes ESCALATED/CLASSIFY_FAILED/DRAFT_FAILED/SEND_FAILED decision)
  - `MessagesService.processIngestedMessage`: full 10-step pipeline with exactly one AgentDecision per message; each failure stage (classify/draft/send) writes a distinct actionTaken; markProcessed() runs on all exit paths
  - **Happy path demo:** verified parent + BOOK + confidence ≥ 0.8 + available slot → `AUTO_SENT` with outbound message written
  - **Escalation demo:** "Can you discount?" → PolicyGate keyword check → `ESCALATED`
- ⏳ Need to: verify cross-service enqueue/consume on Render (production smoke test)

### Phase 1: Foundation (Days 1–2)

**Day 1 (complete):** Scaffold + deploy walking skeleton + smoke test.

**Day 2 (current):**
- Production smoke test: enqueue from Render web, confirm Render worker consumes
- Full Prisma schema (all tables from Data Model section)
- Run migration on Neon (`prisma migrate deploy`)
- Seed script: 1 coach, 5 parents, 5 kids, 10 sessions (mix of completed + upcoming)
- Remove dev-only `/dev/test-job` endpoint from production (guard with `NODE_ENV !== 'production'`)
- Tag `git tag foundation-working`

### Phase 2: Message ingestion pipeline (Day 3)

**Goal:** Full pipeline works end-to-end without LLM.

- `POST /api/messages/inbound` endpoint
- Zod validation of inbound payload (Twilio-shaped)
- Writes to `Message` table with idempotency check
- Enqueues `{ messageId }` to BullMQ
- Worker: loads message from DB, writes placeholder `AgentDecision`, returns
- Integration test: curl the endpoint → see audit row in DB

**At this point:** pipes work, no intelligence yet.

### Phase 3: Agent state machine (Days 4–5)

**Day 4: Intent classification + context loading**
- Build `LLMClient` abstraction (Anthropic SDK wrapper, typed methods)
- Implement `CLASSIFY_INTENT` state (Haiku 4.5, returns structured intent with confidence)
- Use Zod schema for LLM structured output validation
- Implement `LOAD_CONTEXT` state (pulls parent + kid + recent messages from Postgres; Redis cache deferred to Day 5)
- AgentDecision logs intent + confidence
- Write tests for intent classification with fixed fixtures

**Day 5: Guardrails + reply drafting + first happy path**
- `CONFIDENCE_GATE` — routes to AUTO / APPROVE / ESCALATE based on thresholds
- `POLICY_GATE` — hard rule engine (rate discussion, unknown sender, etc.) always wins over LLM
- `DRAFT_REPLY` state (Sonnet 4.6)
- Channel adapter sends the reply (web chat only for now; SMS wired day 6)
- **Happy path working:** "Book Priya Thursday" → intent=book → context loaded → availability checked → reply drafted → auto-sent → audit logged
- **Escalation path working:** "Can you discount?" → policy gate fires → escalate to coach

### Phase 4: Coach dashboard (Day 6)

- Tuesday morning screen: triage view (fires / today / handled)
- Today's sessions as cards with kid + note
- Approval queue view
- Audit log view (latest 50 decisions)
- SSE subscription for real-time updates
- Single hardcoded login (username/password or magic link — don't overbuild auth for one user)

### Phase 5: Channel integrations (Day 7)

- Twilio webhook → channel adapter → same inbound endpoint
- Web chat simulator (QR code → `/demo/parent` route → WebSocket chat)
- Both channels flow through same agent, same audit log
- End of day 7: 20-person stress test locally

### Phase 6: Voice (Days 8–9)

- Gemini Live integration on coach dashboard
- Hold-to-talk mic button
- Transcription shows live
- Voice commands route through state machine (same as text, just different transport)
- Every voice-initiated action shows visual confirmation card before executing
- **Do not let voice become its own agent.** It's a channel, not a brain.

### Phase 7: Observability + payments + polish (Days 10–12)

**Day 10: Observability**
- Fire events to VeriOps (fire-and-forget, circuit breaker so failures don't cascade)
- Minimal `/observability` page in coach dashboard as fallback (queue depth, latency percentiles, recent decisions)
- Events fired: agent decision, escalation, LLM call (model/tokens/latency/cost), tool execution, budget threshold

**Day 11: Payments + session recap**
- Stripe Payment Links integration
- Agent can generate link per session, send via SMS
- Coach post-session voice note → agent drafts parent-friendly recap → coach approves → sent

**Day 12: Polish**
- Empty states, loading states, error states
- Visual consistency pass
- Kill switch button on dashboard (stop all agent processing)
- Demo script (`DEMO.md`) review against actual app behavior

### Phase 8: Demo prep (Days 13–14)

**Day 13:**
- Dry run with 3–4 friends
- Dry run with 8–10 people
- Record backup demo video
- Verify Metin's phone in Twilio (if approved)
- QR code tested on iOS + Android + old Android
- Database seed reset script working
- Kill switch tested

**Day 14:**
- Buffer day (always)
- Final dry run morning of demo
- Demo day

---

## Current known quirks (worth internalizing)

1. **Port 3002, not 3000.** The developer has another project on 3000. Any hardcoded `3000` in the codebase is a bug.
2. **Docker Postgres on 5433, Redis on 6380.** Non-default. Code must read from env.
3. **Web and worker share `AppModule`.** If you add a module that depends on HTTP-specific things (e.g., request scope), guard it so it doesn't break the worker's `createApplicationContext` boot.
4. **Queue name coupling.** Web-side `Queue` and worker-side `Worker` must use the same queue name string. Env vars `DEV_TEST_QUEUE` and `BULLMQ_QUEUE_NAME` exist; don't let them drift.
5. **Prisma config.** Uses the new `prisma.config.ts` with explicit `dotenv/config` import.
6. **Neon connection strings.** Use **pooled** URL for the app (`DATABASE_URL`), **direct** URL for migrations (`DIRECT_URL`). Prisma reads both.
7. **Render Redis internal URL.** For Render web → Render worker communication via Redis, use the **internal** Redis URL (no egress, faster). Not the external one.
8. **BullMQ workers should not run in the HTTP process.** Separate entrypoint (`worker.ts`), separate Render service.

---

## What the developer should NOT do (or allow coding assistants to do)

- Add a new LLM library (LangChain, LlamaIndex, etc.) without discussion. The architecture deliberately avoids these.
- Have the LLM orchestrate the agent flow. LLM is a callable inside states, not the brain.
- Store secrets in the repo. Ever. Even test values go in `.env.example` with placeholders.
- Delete or update rows in `AgentDecision`. It's append-only.
- Build "just for the demo" hacks that can't survive a second week of development. Build real; polish for demo.
- Skip idempotency on webhook endpoints. Twilio will retry.
- Add features that don't appear in `DEMO.md`. If it's not in the demo, it's not in scope for 2 weeks.
- Use `any` in TypeScript. Use `unknown` + narrow, or define the type.
- Silent-catch errors. Every error is logged with context.
- Bypass the policy gate. Even for "obvious" cases. The policy gate is the product.

---

## Core types (lives in `shared/src/types`)

These are the shapes that cross service boundaries. Keep them minimal and stable.

```typescript
// ParentMessage — what the agent consumes, regardless of channel
type ParentMessage = {
  id: string;
  coachId: string;
  parentId: string;
  channel: 'SMS' | 'WEB_CHAT' | 'VOICE';
  content: string;
  receivedAt: Date;
  providerMessageId: string;  // for idempotency
};

type Intent =
  | 'BOOK'
  | 'RESCHEDULE'
  | 'CANCEL'
  | 'QUESTION_LOGISTICS'
  | 'QUESTION_PROGRESS'
  | 'PAYMENT'
  | 'SMALLTALK'
  | 'COMPLAINT'
  | 'AMBIGUOUS'
  | 'OUT_OF_SCOPE';

type ConfidenceTier = 'AUTO' | 'APPROVE' | 'ESCALATE';

type AgentDecision = {
  id: string;
  messageId: string;
  intent: Intent;
  confidence: number;       // 0–1
  tier: ConfidenceTier;
  actionTaken: string;
  reasoning: string;
  llmModel: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  createdAt: Date;
};
```

---

## How to orient fast (for a new AI coding session)

1. Read this file top to bottom. Don't skim the architecture section.
2. Read `CLAUDE.md` for concrete commands and paths.
3. Read `DEMO.md` — if a proposed feature doesn't appear in the demo script, question it.
4. Read the current `prisma/schema.prisma` — this is source of truth for the data model.
5. Check `git log --oneline` and `git tag` to understand what's already shipped.
6. `docker compose ps` to see what's running locally.
7. `pnpm --filter backend start:dev` and `pnpm --filter backend start:worker:dev` to run services.
8. Always ask before: adding new dependencies, changing the agent orchestration pattern, modifying the policy gate, touching `AgentDecision` semantics.

---

## One-line summary for any future session

> Building a two-week agentic coach assistant with hand-rolled state machine, tiered guardrails, full audit log, SMS + web chat + voice channels, demoed to a Siemens VP who's also a parent-user. Protect the coach's attention, eliminate parent uncertainty, every AI action is controlled and logged. Ship the core loop reliably before adding any polish.