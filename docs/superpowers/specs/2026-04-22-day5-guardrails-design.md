# Day 5: Guardrails + Reply Drafting + First Happy Path

**Date:** 2026-04-22  
**Phase:** Phase 3, Day 5  
**Branch:** phase-2-message-ingestion (continue on same branch)

---

## Goal

Complete the first end-to-end agent loop: classify → gate → draft → send (or queue/escalate). At end of day:

- **Happy path:** "Book Priya Thursday" → `BOOK` intent → policy passes → confidence AUTO → draft references only real slots → OUTBOUND message written → `actionTaken=AUTO_SENT`
- **Escalation path:** "Can you discount?" → keyword fence fires in PolicyGate → `actionTaken=ESCALATED`, no draft sent

---

## Invariants (non-negotiable)

- **Exactly one `AgentDecision` row per inbound message**, written at the terminal path only. Never write a "classified" intermediate row and a second terminal row.
- **`AgentDecision` is append-only.** Never UPDATE or DELETE rows.
- **No `Session` rows created in Day 5.** Booking confirmation (writing `Session` with `status=PROPOSED`) is a second-turn flow, out of scope.
- **Nothing gets hallucinated to parents.** `DraftReplyState` is constrained to reference only times present in `context.availableSlots`. `ValidateDraftState` enforces this post-hoc.
- **Distinct failure `actionTaken` values.** `CLASSIFY_FAILED` only for step 3; `DRAFT_FAILED` for step 7; `SEND_FAILED` for step 9. Never reuse `CLASSIFY_FAILED` as a catch-all.
- **On any post-classify failure, the `AgentDecision` row preserves classify data** — real `intent`, `confidence`, `reasoning`, `llmModel`, `tokensIn`, `tokensOut`, `latencyMs` from the successful classify step.
- **`message.processedAt = now` runs regardless of which terminal path fires**, preventing infinite retry loops from orphan recovery.

---

## Section 1: Context shape — `LoadContextState` changes

Add `availableSlots` to `AgentContext`:

```ts
type AvailableSlot = {
  startAt: Date;
  endAt: Date;
  label: string; // pre-formatted in Coach.timezone
};

type AgentContext = {
  parent: Parent;
  kids: Kid[];
  recentMessages: Message[];
  upcomingSessions: Array<Session & { kid: Pick<Kid, 'id' | 'name'> }>;
  availableSlots: AvailableSlot[]; // NEW
};
```

**Query logic:**
1. Fetch `Coach.timezone` for the `coachId` (needed for label formatting).
2. Fetch `Availability` rows where `coachId` matches, `isBlocked=false`, `startAt >= now`, `startAt < now + 14 days`. Max 10 rows, ordered `startAt ASC`.
3. Exclude any slot where an existing `Session` (status `CONFIRMED` or `PROPOSED`) overlaps `[slot.startAt, slot.endAt)`. Overlap condition: `session.scheduledAt < slot.endAt AND (session.scheduledAt + session.durationMinutes * 60s) > slot.startAt`.
4. **Assume availability rows are pre-sliced into bookable chunks by the seed script** (e.g. each row is exactly 1 hour). Do NOT attempt to split partially-booked windows. If the seed doesn't produce pre-sliced rows, raise before coding.
5. Format `label` using `Intl.DateTimeFormat` with `Coach.timezone`. Example: `"Thursday Apr 24, 3:00–4:00 PM"`.

---

## Section 2: PolicyGate

**File:** `backend/src/modules/agent/gates/policy-gate.ts`  
**Type:** Pure function, zero I/O, fully unit-tested with fixed inputs.

```ts
type PolicyGateInput = {
  intent: Intent;
  parentKnown: boolean;
  content: string;
};

type PolicyGateResult = { tier: 'ESCALATE'; reason: string } | null;
```

**Rules (evaluated in order, first match wins):**

1. `!parentKnown` → `ESCALATE`, reason: `"Unknown sender"`
2. `intent` in `['PAYMENT', 'COMPLAINT', 'AMBIGUOUS', 'OUT_OF_SCOPE']` → `ESCALATE`, reason: `"Intent requires coach review"`
3. Content matches keyword regex → `ESCALATE`, reason: `"Sensitive keyword detected"`

**Keyword regex (sealed list, extend only with deliberate review):**
```
/\b(discount|refund|refunds|rate|rates|price|prices|fee|fees|medical|injury|hurt|lawsuit|complaint|complaints)\b/i
```

**Critical:** The keyword check fires **regardless of intent**. If `content` matches the regex, PolicyGate escalates even when the classifier returned `QUESTION_LOGISTICS`. This is the backstop for classifier mis-labeling (e.g. "what's the refund policy?" classified as logistics).

Returns `null` when no rule fires → flow proceeds to ConfidenceGate.

---

## Section 3: ConfidenceGate

**File:** `backend/src/modules/agent/gates/confidence-gate.ts`  
**Type:** Pure function, zero I/O.

```ts
type ConfidenceGateInput = {
  intent: Intent;
  confidence: number; // 0–1
  parentKnown: boolean;
  hasAvailableSlots: boolean;
};
```

**Rules (evaluated in order):**

1. `BOOK` + `parentKnown` + `confidence >= 0.80` + `hasAvailableSlots` → `AUTO`
2. `BOOK` (any other case) → `APPROVE`
3. `QUESTION_LOGISTICS` + `parentKnown` + `confidence >= 0.80` → `AUTO`
4. `RESCHEDULE` → `APPROVE` (always — per spec: reschedules require coach approval)
5. `CANCEL` → `APPROVE` (always — confirmation required)
6. `QUESTION_PROGRESS` → `APPROVE` (personal, requires coach knowledge)
7. `SMALLTALK` → `APPROVE` (always for Day 5 — autonomous smalltalk not yet earned)
8. Fallback → `APPROVE`

**Never returns `ESCALATE`** — that is exclusively PolicyGate's job.

---

## Section 4: DraftReplyState

**File:** `backend/src/modules/agent/states/draft-reply.state.ts`  
**Model:** `claude-sonnet-4-6` (add `DRAFTING_MODEL = 'claude-sonnet-4-6'` to `llm.constants.ts`)  
**Only called when tier is `AUTO` or `APPROVE`. Never called for `ESCALATE`.**

```ts
type DraftReplyInput = {
  message: Message;
  context: AgentContext;
  intent: Intent;
  tier: ConfidenceTier;
};

type DraftReplyResult = {
  draft: string;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
};
```

**Prompt structure:**

- **System:** "You are an SMS reply drafter for a solo coach. Tone: warm, professional, brief. Maximum 3 sentences. Never invent facts. Only reference session times that appear verbatim in the provided available slots list — if no slots are listed, do not invent times."
- **User:** Structured block containing:
  - Parent name, kid names
  - Intent
  - Available slots: newline-separated `label` strings from `context.availableSlots` (empty list if none)
  - Original message content
  - Tier hint: `AUTO` → "Reply confidently and decisively." `APPROVE` → "Reply warmly but tentatively — the coach will review before sending."
- **Schema:** `z.object({ reply: z.string().max(500) })` — validated via `LlmClient.classify<T>`.
- **`max_tokens: 200`** — hard ceiling, SMS-length.

**Example outputs:**
- BOOK AUTO with slots: "Hi Sarah! Priya's session is available Thursday Apr 24 at 3:00 PM — does that work for you?"
- BOOK APPROVE (no slots): "Hi Sarah! I'll check with the coach on availability for Priya this week and get back to you shortly."
- QUESTION_LOGISTICS AUTO: Answers from context (session time, location from session/kid data).

---

## Section 5: ValidateDraftState

**File:** `backend/src/modules/agent/states/validate-draft.state.ts`  
**Type:** Pure function (~15 lines), no I/O, no LLM call, no DB write.

```ts
type ValidateDraftInput = {
  draft: string;
  availableSlots: AvailableSlot[];
  tier: ConfidenceTier;
  intent: Intent;
};

type ValidateDraftResult = {
  tier: ConfidenceTier;
  downgraded: boolean;
  reason?: string;
};
```

**Logic:**
1. Only active when `intent === 'BOOK'`. For other intents, return `{ tier, downgraded: false }` unchanged.
2. Extract time-like tokens from draft using regex: `\b\d{1,2}:\d{2}\s?(AM|PM|am|pm)?\b` and day-of-week names (`Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday`).
3. For each extracted token, check if it appears as a substring in any `availableSlots[].label`.
4. If any token has no match → downgrade: `{ tier: 'APPROVE', downgraded: true, reason: 'Draft referenced time not in availableSlots' }`.
5. Otherwise → `{ tier, downgraded: false }`.

This is the hallucination backstop: even if `ConfidenceGate` returned `AUTO`, a draft that mentions a time not in the slot list gets downgraded to `APPROVE`.

---

## Section 6: OutboundService

**File:** `backend/src/modules/agent/outbound/outbound.service.ts`

Three terminal paths, each writes exactly one `AgentDecision` row:

### AUTO path — `autoSend()`
1. Write OUTBOUND `Message` to DB: `{ coachId, parentId, direction: 'OUTBOUND', channel: parent.preferredChannel, providerMessageId: uuid(), content: draft, receivedAt: now }`.
2. Write `AgentDecision`: `{ actionTaken: 'AUTO_SENT', tier: 'AUTO', intent, confidence, reasoning, llmModel, tokensIn, tokensOut, latencyMs }`.
3. Channel delivery (WebSocket/SMS) is wired in Day 6. The OUTBOUND message row IS the send artifact for Day 5.

### APPROVE path — `queueForApproval()`
1. Write `ApprovalQueue`: `{ coachId, messageId, draftReply: draft, status: 'PENDING' }`.
2. Write `AgentDecision`: `{ actionTaken: 'QUEUED_FOR_APPROVAL', tier: 'APPROVE', intent, confidence, reasoning, llmModel, tokensIn, tokensOut, latencyMs }`.
3. No OUTBOUND message written yet — coach approves before sending.

### ESCALATE path — `escalate()`

`escalate()` accepts an optional `classifyResult` parameter. When PolicyGate fires after a successful classify (step 5), pass the classify result so it is preserved. When classify itself failed (step 3 catch), pass nothing — all classify fields are null.

1. Write `AgentDecision`: `{ actionTaken: 'ESCALATED', tier: 'ESCALATE', intent: classifyResult?.intent ?? 'AMBIGUOUS', confidence: classifyResult?.confidence ?? 0, reasoning: policyReason, llmModel: classifyResult?.model ?? null, tokensIn: classifyResult?.usage.tokensIn ?? null, tokensOut: classifyResult?.usage.tokensOut ?? null, latencyMs: classifyResult?.latencyMs ?? null }`.
2. No draft, no OUTBOUND message, no `ApprovalQueue` row.

---

## Section 7: Orchestration — `MessagesService.processIngestedMessage`

Replaces the Day 4 classify-only pipeline. **Exactly one `AgentDecision` row written per message, at the terminal path.**

```
1.  Idempotency check → skip if AgentDecision already exists for messageId
2.  Load message + parent from DB
3.  ClassifyIntentState.classifyIntent()
    └─ catch → OutboundService.escalate(errorReason, classifyResult=undefined)
               → AgentDecision: intent=AMBIGUOUS, confidence=0, actionTaken=CLASSIFY_FAILED, all llm fields null
               → mark message.processedAt = now → return
4.  LoadContextState.loadContext()
5.  PolicyGate.check()
    └─ if fires → OutboundService.escalate(policyReason, classifyResult)
                  mark message.processedAt = now → return
6.  ConfidenceGate.determine()
7.  DraftReplyState.draft()
    └─ catch → write AgentDecision(actionTaken=DRAFT_FAILED, preserving classifyResult fields)
               → mark message.processedAt = now → return
8.  ValidateDraftState.validate()   [may downgrade tier AUTO → APPROVE]
9.  if tier === AUTO  → OutboundService.autoSend()
    if tier === APPROVE → OutboundService.queueForApproval()
    └─ catch → write AgentDecision(actionTaken=SEND_FAILED, preserving classifyResult fields)
               → mark message.processedAt = now → return
10. mark message.processedAt = now (happy path)
```

**Failure preservation rule:** Any `AgentDecision` written in a catch block after step 3 succeeds must carry the real `intent`, `confidence`, `reasoning`, `llmModel`, `tokensIn`, `tokensOut`, `latencyMs` from the successful classify result. Only `actionTaken` reflects the failure; the classification data is never zeroed.

**`message.processedAt = now` must run on every exit path** (happy path and all catch blocks) to prevent orphan recovery from re-enqueuing the message.

---

## Files changed / created

### New files
| File | Purpose |
|---|---|
| `backend/src/modules/agent/gates/policy-gate.ts` | PolicyGate pure function |
| `backend/src/modules/agent/gates/policy-gate.spec.ts` | Unit tests: keyword triggers, intent triggers, clean pass |
| `backend/src/modules/agent/gates/confidence-gate.ts` | ConfidenceGate pure function |
| `backend/src/modules/agent/gates/confidence-gate.spec.ts` | Unit tests: all tier mappings |
| `backend/src/modules/agent/states/draft-reply.state.ts` | DraftReplyState (Sonnet 4.6) |
| `backend/src/modules/agent/states/draft-reply.state.spec.ts` | Unit tests with mock LLM |
| `backend/src/modules/agent/states/validate-draft.state.ts` | ValidateDraftState pure function |
| `backend/src/modules/agent/states/validate-draft.state.spec.ts` | Unit tests: downgrade cases, pass cases |
| `backend/src/modules/agent/outbound/outbound.service.ts` | Three terminal path writers |
| `backend/src/modules/agent/outbound/outbound.service.spec.ts` | Unit tests: AUTO/APPROVE/ESCALATE DB writes |

### Modified files
| File | Change |
|---|---|
| `backend/src/modules/agent/states/load-context.state.ts` | Add `availableSlots` query + Coach tz fetch |
| `backend/src/modules/agent/states/load-context.state.spec.ts` | Update tests for new field |
| `backend/src/modules/agent/agent.module.ts` | Register PolicyGate, ConfidenceGate, DraftReplyState, ValidateDraftState, OutboundService |
| `backend/src/modules/agent/llm/llm.constants.ts` | Add `DRAFTING_MODEL = 'claude-sonnet-4-6'` |
| `backend/src/modules/messages/messages.service.ts` | Full Day 5 pipeline orchestration |
| `backend/src/modules/messages/messages.service.spec.ts` | Update unit tests for new paths |
| `backend/test/messages.e2e-spec.ts` | Add happy-path and escalation e2e scenarios |

---

## Seed assumption

The seed script produces `Availability` rows pre-sliced into bookable chunks (e.g. exactly 1-hour windows). `LoadContextState` does NOT attempt to split partially-booked windows. If the seed does not produce this shape, it must be fixed before `availableSlots` logic is coded.

---

## Out of scope for Day 5

- Writing `Session` rows (that's the second-turn confirmation flow)
- WebSocket/SMS delivery of OUTBOUND messages (Day 6)
- Redis caching of agent context (deferred from Day 4, still deferred)
- `ApprovalQueue` expiration / auto-escalation (Day 7)
- SSE push to coach dashboard (Day 6)
