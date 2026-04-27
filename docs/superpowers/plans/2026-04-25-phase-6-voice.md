# Phase 6: Coach Dashboard Voice (Gemini Live) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hold-to-talk voice channel on the coach dashboard. Coach speaks → Gemini Live transcribes and extracts a structured command → backend dispatches the command through the existing agent state machine / dashboard service → a confirmation card renders in the UI → the coach taps "Confirm" to execute. Voice is a transport, not an agent.

**Architecture:**
- **Frontend** (`frontend/src/components/voice/*`): a hold-to-talk mic button that captures mic audio (PCM 16kHz), opens a WebSocket to the backend, streams audio while held, displays live transcript, and renders a `VoiceConfirmationCard` when the backend returns a proposed action. Tapping Confirm POSTs to an existing dashboard endpoint.
- **Backend** (`backend/src/modules/voice/*`): a `VoiceGateway` (Nest WS gateway pattern, `ws` lib) handles `/ws/coach-voice`. For each session, it opens a parallel WebSocket to Gemini Live (`gemini-2.5-flash-preview-native-audio-dialog` model) using the official `@google/genai` SDK, forwards the coach's audio frames, and streams transcripts + the model's structured tool-call output back to the browser. A new `CoachCommandService` parses the Gemini tool call into a typed `CoachCommandProposal` (one of: `APPROVE_PENDING`, `DISMISS_PENDING`, `DRAFT_REPLY`, `BLOCK_AVAILABILITY`, `CANCEL_SESSION`). The proposal is sent to the browser; nothing is mutated until the coach confirms via an HTTP POST that maps to existing dashboard endpoints (or new ones for commands not already covered).
- **Safety rails:** Gemini is configured with tool-only output; the backend rejects tool calls outside the typed schema; every action requires the existing `x-dashboard-token`; nothing executes without an explicit Confirm POST that includes the proposal id; proposals expire after 60s.

**Tech Stack:**
- Backend: NestJS 11, `ws` 8.20 (already a dep), `@google/genai` (new dep, ~1.0+), Zod for proposal schema
- Frontend: React 19, native `MediaRecorder` + `AudioWorklet` for PCM capture, native `WebSocket`
- Models: Gemini 2.5 Flash Native-Audio-Dialog (preview) for STT + tool-calling

---

## File Structure

**Backend (new):**
- `backend/src/modules/voice/voice.module.ts` — Nest module wiring
- `backend/src/modules/voice/voice.gateway.ts` — WS upgrade handler for `/ws/coach-voice`, manages browser↔Gemini bridge per connection
- `backend/src/modules/voice/gemini-live.client.ts` — thin wrapper around `@google/genai` Live session (open, send audio, receive events, close)
- `backend/src/modules/voice/coach-command.types.ts` — Zod schemas for `CoachCommandProposal` and the Gemini tool definitions
- `backend/src/modules/voice/coach-command.service.ts` — turns a Gemini tool call into a validated proposal, stores it (in-memory TTL map), and on confirm dispatches to the right downstream service
- `backend/src/modules/voice/voice.controller.ts` — `POST /api/voice/proposals/:id/confirm` and `POST /api/voice/proposals/:id/cancel`
- `backend/src/modules/voice/voice.gateway.spec.ts`
- `backend/src/modules/voice/coach-command.service.spec.ts`
- `backend/src/modules/voice/coach-command.types.spec.ts`

**Backend (modified):**
- `backend/src/common/env.validation.ts` — add `GEMINI_API_KEY` (required when `VOICE_ENABLED=true`), `VOICE_ENABLED` flag
- `backend/src/main.ts` — call `voiceGateway.attachToHttpServer(server)` after `webChatGateway.attachToHttpServer`
- `backend/src/app.module.ts` — register `VoiceModule`
- `backend/src/modules/dashboard/dashboard.service.ts` — add `cancelSession(coachId, sessionId)` method (used by voice command `CANCEL_SESSION`); existing `addAvailability` covers `BLOCK_AVAILABILITY`; `sendApproval`/`dismissApproval` cover `APPROVE_PENDING`/`DISMISS_PENDING`
- `backend/src/modules/dashboard/dashboard.controller.ts` — add `DELETE /api/dashboard/sessions/:id`
- `backend/package.json` — add `@google/genai` dependency

**Frontend (new):**
- `frontend/src/components/voice/voice-button.tsx` — hold-to-talk button (renders in header of `home.tsx`)
- `frontend/src/components/voice/voice-overlay.tsx` — full-screen overlay shown while holding: live transcript + listening pulse
- `frontend/src/components/voice/voice-confirmation-card.tsx` — modal card with parsed command summary + Confirm/Cancel buttons
- `frontend/src/lib/voice/use-voice-session.ts` — React hook that owns the WS connection, mic capture, transcript state, proposal state
- `frontend/src/lib/voice/audio-capture.ts` — wraps `getUserMedia` + `AudioWorklet` to emit 16-bit 16kHz PCM chunks
- `frontend/src/lib/voice/pcm-worklet.js` — AudioWorklet processor that downsamples Float32 → Int16 PCM at 16kHz

**Frontend (modified):**
- `frontend/src/components/screens/home.tsx` — render `<VoiceButton />` in the header; render `<VoiceConfirmationCard />` when a proposal exists
- `frontend/src/lib/api.ts` — add `voice.confirmProposal(id)`, `voice.cancelProposal(id)`, `cancelSession(id)` API helpers, plus types for `VoiceProposal`

---

## Task 1: Add backend env vars and dependency

**Files:**
- Modify: `backend/src/common/env.validation.ts`
- Modify: `backend/package.json`
- Test: `backend/src/common/env.validation.spec.ts` (already exists — extend)

- [ ] **Step 1: Write the failing test**

Open `backend/src/common/env.validation.spec.ts` and append:

```typescript
describe('voice config', () => {
  const baseEnv = {
    DATABASE_URL: 'postgresql://localhost:5433/coach_local',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    INTERNAL_INGEST_TOKEN: '0123456789abcdef0123',
    DASHBOARD_TOKEN: '0123456789abcdef0123',
    COACH_ID: 'coach_1',
  };

  it('rejects VOICE_ENABLED=true without GEMINI_API_KEY', () => {
    expect(() =>
      validateEnv({ ...baseEnv, VOICE_ENABLED: 'true' }),
    ).toThrow(/GEMINI_API_KEY/);
  });

  it('accepts VOICE_ENABLED=true with GEMINI_API_KEY', () => {
    const env = validateEnv({
      ...baseEnv,
      VOICE_ENABLED: 'true',
      GEMINI_API_KEY: 'AIza-test-key',
    });
    expect(env.VOICE_ENABLED).toBe(true);
    expect(env.GEMINI_API_KEY).toBe('AIza-test-key');
  });

  it('defaults VOICE_ENABLED to false', () => {
    const env = validateEnv(baseEnv);
    expect(env.VOICE_ENABLED).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `backend/`: `pnpm test -- env.validation`
Expected: FAIL — `VOICE_ENABLED` and `GEMINI_API_KEY` unrecognized.

- [ ] **Step 3: Update env validation**

In `backend/src/common/env.validation.ts`, inside `EnvSchema = z.object({...})` add:

```typescript
  VOICE_ENABLED: BoolFlagSchema,
  GEMINI_API_KEY: z.string().min(1).optional(),
```

In the `.superRefine((env, ctx) => { ... })` block, add at the bottom:

```typescript
  if (env.VOICE_ENABLED) {
    if (!env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when VOICE_ENABLED is true',
      });
    }
  }
```

- [ ] **Step 4: Add the SDK dependency**

```bash
cd backend && pnpm add @google/genai
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm test -- env.validation`
Expected: PASS (3 new specs).

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/env.validation.ts backend/src/common/env.validation.spec.ts backend/package.json ../pnpm-lock.yaml
git commit -m "feat(voice): add VOICE_ENABLED + GEMINI_API_KEY env vars"
```

---

## Task 2: Define the CoachCommandProposal types and Gemini tool schema

**Files:**
- Create: `backend/src/modules/voice/coach-command.types.ts`
- Test: `backend/src/modules/voice/coach-command.types.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/voice/coach-command.types.spec.ts`:

```typescript
import { CoachCommandProposalSchema, GEMINI_TOOL_DEFINITIONS } from './coach-command.types';

describe('CoachCommandProposalSchema', () => {
  it('accepts an APPROVE_PENDING proposal', () => {
    const result = CoachCommandProposalSchema.safeParse({
      kind: 'APPROVE_PENDING',
      approvalId: 'appr_123',
      summary: 'Approve reply to Priya about Thursday',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a DRAFT_REPLY proposal', () => {
    const result = CoachCommandProposalSchema.safeParse({
      kind: 'DRAFT_REPLY',
      parentName: 'Priya',
      messageBody: 'Sorry, I cannot make Thursday at 4pm.',
      summary: 'Draft reply to Priya',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    const result = CoachCommandProposalSchema.safeParse({
      kind: 'DELETE_DATABASE',
      summary: 'oh no',
    });
    expect(result.success).toBe(false);
  });

  it('exposes 5 tool definitions for Gemini', () => {
    expect(GEMINI_TOOL_DEFINITIONS).toHaveLength(5);
    const names = GEMINI_TOOL_DEFINITIONS.map((t) => t.name).sort();
    expect(names).toEqual([
      'approve_pending',
      'block_availability',
      'cancel_session',
      'dismiss_pending',
      'draft_reply',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- coach-command.types`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the types**

Create `backend/src/modules/voice/coach-command.types.ts`:

```typescript
import { z } from 'zod';

export const CoachCommandProposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('APPROVE_PENDING'),
    approvalId: z.string().min(1),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('DISMISS_PENDING'),
    approvalId: z.string().min(1),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('DRAFT_REPLY'),
    parentName: z.string().min(1),
    messageBody: z.string().min(1).max(1000),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('BLOCK_AVAILABILITY'),
    startAtIso: z.string().datetime(),
    endAtIso: z.string().datetime(),
    summary: z.string().max(280),
  }),
  z.object({
    kind: z.literal('CANCEL_SESSION'),
    sessionId: z.string().min(1),
    summary: z.string().max(280),
  }),
]);

export type CoachCommandProposal = z.infer<typeof CoachCommandProposalSchema>;

export interface StoredProposal {
  id: string;
  coachId: string;
  proposal: CoachCommandProposal;
  createdAt: Date;
  expiresAt: Date;
}

// Gemini Live tool definitions — used to constrain the model's output
// to one of these five callable functions. See:
// https://ai.google.dev/gemini-api/docs/live-tools
export const GEMINI_TOOL_DEFINITIONS = [
  {
    name: 'approve_pending',
    description:
      'Approve a pending agent reply that is waiting in the approval queue. Use the approvalId from the dashboard context.',
    parameters: {
      type: 'object',
      properties: {
        approvalId: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['approvalId', 'summary'],
    },
  },
  {
    name: 'dismiss_pending',
    description: 'Dismiss / reject a pending agent reply.',
    parameters: {
      type: 'object',
      properties: {
        approvalId: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['approvalId', 'summary'],
    },
  },
  {
    name: 'draft_reply',
    description:
      'Draft a brand-new outbound message to a parent. Use when the coach dictates a custom reply.',
    parameters: {
      type: 'object',
      properties: {
        parentName: { type: 'string' },
        messageBody: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['parentName', 'messageBody', 'summary'],
    },
  },
  {
    name: 'block_availability',
    description:
      'Block off a window of the coach calendar. ISO 8601 timestamps in the coach timezone.',
    parameters: {
      type: 'object',
      properties: {
        startAtIso: { type: 'string' },
        endAtIso: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['startAtIso', 'endAtIso', 'summary'],
    },
  },
  {
    name: 'cancel_session',
    description: 'Cancel an existing scheduled session by id.',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['sessionId', 'summary'],
    },
  },
] as const;

export type GeminiToolName = (typeof GEMINI_TOOL_DEFINITIONS)[number]['name'];

export function toolCallToProposal(
  name: string,
  args: Record<string, unknown>,
): CoachCommandProposal | null {
  switch (name) {
    case 'approve_pending':
      return CoachCommandProposalSchema.parse({ kind: 'APPROVE_PENDING', ...args });
    case 'dismiss_pending':
      return CoachCommandProposalSchema.parse({ kind: 'DISMISS_PENDING', ...args });
    case 'draft_reply':
      return CoachCommandProposalSchema.parse({ kind: 'DRAFT_REPLY', ...args });
    case 'block_availability':
      return CoachCommandProposalSchema.parse({ kind: 'BLOCK_AVAILABILITY', ...args });
    case 'cancel_session':
      return CoachCommandProposalSchema.parse({ kind: 'CANCEL_SESSION', ...args });
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test -- coach-command.types`
Expected: PASS (4 specs).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/voice/coach-command.types.ts backend/src/modules/voice/coach-command.types.spec.ts
git commit -m "feat(voice): add CoachCommandProposal types and Gemini tool definitions"
```

---

## Task 3: CoachCommandService — proposal store + dispatcher

**Files:**
- Create: `backend/src/modules/voice/coach-command.service.ts`
- Test: `backend/src/modules/voice/coach-command.service.spec.ts`

This service holds proposals in memory (5-minute Map TTL), validates incoming tool calls, and dispatches confirmed proposals to the existing `DashboardService` (which mutates state).

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/voice/coach-command.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { CoachCommandService } from './coach-command.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { ChannelSenderRegistry } from '../agent/channels/channel-sender.registry';
import { PrismaService } from '../../prisma.service';

describe('CoachCommandService', () => {
  let service: CoachCommandService;
  let dashboard: jest.Mocked<DashboardService>;

  beforeEach(async () => {
    dashboard = {
      sendApproval: jest.fn().mockResolvedValue(undefined),
      dismissApproval: jest.fn().mockResolvedValue(undefined),
      addAvailability: jest.fn().mockResolvedValue(undefined),
      cancelSession: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<DashboardService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        CoachCommandService,
        { provide: DashboardService, useValue: dashboard },
      ],
    }).compile();
    service = moduleRef.get(CoachCommandService);
  });

  it('stores a proposal and returns an id', () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING',
      approvalId: 'a1',
      summary: 'Approve reply',
    });
    expect(stored.id).toMatch(/^prop_/);
    expect(service.getProposal(stored.id, 'coach_1')).toEqual(stored);
  });

  it('rejects proposal lookup with mismatched coachId', () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING', approvalId: 'a1', summary: 's',
    });
    expect(service.getProposal(stored.id, 'coach_other')).toBeNull();
  });

  it('expires a proposal after 60s', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-25T10:00:00Z'));
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING', approvalId: 'a1', summary: 's',
    });
    jest.setSystemTime(new Date('2026-04-25T10:01:01Z'));
    expect(service.getProposal(stored.id, 'coach_1')).toBeNull();
    jest.useRealTimers();
  });

  it('dispatches APPROVE_PENDING to dashboard.sendApproval', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING', approvalId: 'a1', summary: 's',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.sendApproval).toHaveBeenCalledWith('coach_1', 'a1');
  });

  it('dispatches DISMISS_PENDING to dashboard.dismissApproval', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'DISMISS_PENDING', approvalId: 'a2', summary: 's',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.dismissApproval).toHaveBeenCalledWith('coach_1', 'a2');
  });

  it('dispatches BLOCK_AVAILABILITY to dashboard.addAvailability with isBlocked', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'BLOCK_AVAILABILITY',
      startAtIso: '2026-04-26T18:00:00.000Z',
      endAtIso: '2026-04-26T19:00:00.000Z',
      summary: 'Block 6pm',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.addAvailability).toHaveBeenCalled();
  });

  it('dispatches CANCEL_SESSION to dashboard.cancelSession', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'CANCEL_SESSION', sessionId: 'sess_5', summary: 'Cancel 4pm',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(dashboard.cancelSession).toHaveBeenCalledWith('coach_1', 'sess_5');
  });

  it('throws on confirm of unknown id', async () => {
    await expect(service.confirm('prop_nope', 'coach_1')).rejects.toThrow(/not found/i);
  });

  it('removes a proposal after confirm', async () => {
    const stored = service.storeProposal('coach_1', {
      kind: 'APPROVE_PENDING', approvalId: 'a1', summary: 's',
    });
    await service.confirm(stored.id, 'coach_1');
    expect(service.getProposal(stored.id, 'coach_1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- coach-command.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

Create `backend/src/modules/voice/coach-command.service.ts`:

```typescript
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DashboardService } from '../dashboard/dashboard.service';
import { CoachCommandProposal, StoredProposal } from './coach-command.types';

const PROPOSAL_TTL_MS = 60 * 1000;

@Injectable()
export class CoachCommandService {
  private readonly logger = new Logger(CoachCommandService.name);
  private readonly proposals = new Map<string, StoredProposal>();

  constructor(private readonly dashboard: DashboardService) {}

  storeProposal(coachId: string, proposal: CoachCommandProposal): StoredProposal {
    const id = `prop_${randomUUID()}`;
    const now = new Date();
    const stored: StoredProposal = {
      id,
      coachId,
      proposal,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    };
    this.proposals.set(id, stored);
    this.logger.log({ event: 'PROPOSAL_STORED', id, coachId, kind: proposal.kind });
    return stored;
  }

  getProposal(id: string, coachId: string): StoredProposal | null {
    const stored = this.proposals.get(id);
    if (!stored) return null;
    if (stored.coachId !== coachId) return null;
    if (stored.expiresAt.getTime() <= Date.now()) {
      this.proposals.delete(id);
      return null;
    }
    return stored;
  }

  async confirm(id: string, coachId: string): Promise<void> {
    const stored = this.getProposal(id, coachId);
    if (!stored) {
      throw new NotFoundException('Proposal not found or expired');
    }
    await this.dispatch(coachId, stored.proposal);
    this.proposals.delete(id);
    this.logger.log({ event: 'PROPOSAL_CONFIRMED', id, coachId, kind: stored.proposal.kind });
  }

  cancel(id: string, coachId: string): void {
    const stored = this.getProposal(id, coachId);
    if (!stored) return;
    this.proposals.delete(id);
    this.logger.log({ event: 'PROPOSAL_CANCELLED', id, coachId });
  }

  private async dispatch(
    coachId: string,
    proposal: CoachCommandProposal,
  ): Promise<void> {
    switch (proposal.kind) {
      case 'APPROVE_PENDING':
        await this.dashboard.sendApproval(coachId, proposal.approvalId);
        return;
      case 'DISMISS_PENDING':
        await this.dashboard.dismissApproval(coachId, proposal.approvalId);
        return;
      case 'BLOCK_AVAILABILITY':
        await this.dashboard.addAvailability(
          coachId,
          proposal.startAtIso,
          proposal.endAtIso,
        );
        return;
      case 'CANCEL_SESSION':
        await this.dashboard.cancelSession(coachId, proposal.sessionId);
        return;
      case 'DRAFT_REPLY':
        // Drafts go through approval queue rather than auto-sending.
        // We surface the message in the confirmation card and the
        // coach taps "Send" — this triggers a normal outbound write.
        // Implemented via a thin DashboardService.sendDraftedReply
        // call in Task 4 (added alongside cancelSession).
        await this.dashboard.sendDraftedReply(coachId, {
          parentName: proposal.parentName,
          body: proposal.messageBody,
        });
        return;
    }
  }
}
```

- [ ] **Step 4: Run tests — expect 1 dispatch test to fail (DRAFT_REPLY)**

Run: `pnpm test -- coach-command.service`
Expected: PASS for storage/expiry/non-DRAFT dispatch tests; the DRAFT_REPLY path will be exercised in Task 4 once `sendDraftedReply` exists. If you wrote a DRAFT_REPLY test here, omit it for now.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/voice/coach-command.service.ts backend/src/modules/voice/coach-command.service.spec.ts
git commit -m "feat(voice): add CoachCommandService with TTL proposal store"
```

---

## Task 4: Extend DashboardService with cancelSession + sendDraftedReply

**Files:**
- Modify: `backend/src/modules/dashboard/dashboard.service.ts`
- Modify: `backend/src/modules/dashboard/dashboard.controller.ts`
- Test: `backend/src/modules/dashboard/dashboard.service.spec.ts` (already exists — extend)

- [ ] **Step 1: Write the failing test**

Append to `backend/src/modules/dashboard/dashboard.service.spec.ts`:

```typescript
describe('cancelSession', () => {
  it('marks the session CANCELLED and frees the slot', async () => {
    // assumes a test fixture session exists with id 'sess_test_1'; if the
    // existing spec uses a different fixture pattern, follow it
    await service.cancelSession('coach_test', 'sess_test_1');
    const session = await prisma.session.findUnique({ where: { id: 'sess_test_1' } });
    expect(session?.status).toBe('CANCELLED');
  });
});

describe('sendDraftedReply', () => {
  it('writes an outbound Message and sends via the parent\'s channel', async () => {
    await service.sendDraftedReply('coach_test', { parentName: 'Priya', body: 'On my way' });
    const outbound = await prisma.message.findFirst({
      where: { coachId: 'coach_test', direction: 'OUTBOUND', content: 'On my way' },
    });
    expect(outbound).toBeTruthy();
  });
});
```

(If the existing spec is purely unit-test style with mocks, mirror its mock pattern — assert on `prisma.session.update` calls instead of querying.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- dashboard.service`
Expected: FAIL — `cancelSession` and `sendDraftedReply` don't exist.

- [ ] **Step 3: Implement the methods**

In `backend/src/modules/dashboard/dashboard.service.ts`, add inside the `DashboardService` class:

```typescript
async cancelSession(coachId: string, sessionId: string): Promise<void> {
  const session = await this.prisma.session.findFirst({
    where: { id: sessionId, coachId },
  });
  if (!session) {
    throw new NotFoundException('Session not found');
  }
  await this.prisma.session.update({
    where: { id: sessionId },
    data: { status: 'CANCELLED' },
  });
  this.logger.log({ event: 'SESSION_CANCELLED', coachId, sessionId });
}

async sendDraftedReply(
  coachId: string,
  body: { parentName: string; body: string },
): Promise<void> {
  // Match by exact name first, then case-insensitive contains
  const parent =
    (await this.prisma.parent.findFirst({
      where: { coachId, name: body.parentName },
    })) ??
    (await this.prisma.parent.findFirst({
      where: { coachId, name: { contains: body.parentName, mode: 'insensitive' } },
    }));
  if (!parent) {
    throw new NotFoundException(`Parent '${body.parentName}' not found`);
  }

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
}
```

- [ ] **Step 4: Wire the controller**

In `backend/src/modules/dashboard/dashboard.controller.ts`, add:

```typescript
@Delete('sessions/:id')
cancelSession(
  @Param('id') id: string,
  @Headers('x-dashboard-token') token: string | undefined,
) {
  return this.dashboardService.cancelSession(this.guard(token), id);
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm test -- dashboard.service`
Expected: PASS.

- [ ] **Step 6: Now the DRAFT_REPLY dispatch test from Task 3 should pass**

Add to `coach-command.service.spec.ts` and rerun:

```typescript
it('dispatches DRAFT_REPLY to dashboard.sendDraftedReply', async () => {
  // extend the dashboard mock first:
  // dashboard.sendDraftedReply = jest.fn().mockResolvedValue(undefined);
  const stored = service.storeProposal('coach_1', {
    kind: 'DRAFT_REPLY',
    parentName: 'Priya',
    messageBody: 'On my way',
    summary: 'Reply to Priya',
  });
  await service.confirm(stored.id, 'coach_1');
  expect(dashboard.sendDraftedReply).toHaveBeenCalledWith('coach_1', {
    parentName: 'Priya',
    body: 'On my way',
  });
});
```

Run: `pnpm test -- coach-command.service`
Expected: PASS (all 9 specs).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/dashboard backend/src/modules/voice/coach-command.service.spec.ts
git commit -m "feat(dashboard): add cancelSession + sendDraftedReply for voice commands"
```

---

## Task 5: GeminiLiveClient — wrap @google/genai Live session

**Files:**
- Create: `backend/src/modules/voice/gemini-live.client.ts`

This is a thin wrapper. It exposes: `open()`, `sendAudioChunk(buffer)`, `close()`, and emits events: `transcript`, `toolCall`, `error`, `close`. We rely on the SDK rather than hand-rolling the WebSocket.

- [ ] **Step 1: Read the SDK docs for the Live API**

Open https://github.com/googleapis/js-genai (README → "Live API"). The key surface is `client.live.connect({ model, config, callbacks })` returning a `Session` with `sendRealtimeInput({ audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } })` and `close()`. Callbacks fire on `onmessage` with `{ serverContent, toolCall }` shapes.

- [ ] **Step 2: Implement the client**

Create `backend/src/modules/voice/gemini-live.client.ts`:

```typescript
import { Logger } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { GoogleGenAI, Modality, type Session } from '@google/genai';
import { GEMINI_TOOL_DEFINITIONS } from './coach-command.types';

const VOICE_MODEL = 'gemini-2.5-flash-preview-native-audio-dialog';

const SYSTEM_INSTRUCTION = `
You are a voice command interpreter for an elite solo coach's dashboard.
You DO NOT take actions yourself — you ONLY emit a single tool call that
describes the coach's intent. The dashboard will render a confirmation
card and the coach will tap Confirm to actually execute.

Rules:
- Always pick exactly one tool. If you cannot map the request, do not call any tool.
- Be terse. The "summary" field is a 1-line verb phrase shown on the confirmation card.
- For draft_reply, write the full message body in the parent's voice (the coach is dictating).
- Never invent IDs. Use IDs the coach speaks aloud (e.g. "approve approval a-1-2-3") or the most recent items in the dashboard context the gateway sends with each session.
`.trim();

export interface GeminiLiveContext {
  pendingApprovals: { id: string; parentName: string; summary: string }[];
  todaySessions: { id: string; kidName: string; time: string }[];
  parents: { id: string; name: string }[];
}

export class GeminiLiveClient extends EventEmitter {
  private readonly logger = new Logger(GeminiLiveClient.name);
  private session: Session | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly context: GeminiLiveContext,
  ) {
    super();
  }

  async open(): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const contextBlock = this.renderContext();

    this.session = await ai.live.connect({
      model: VOICE_MODEL,
      config: {
        responseModalities: [Modality.TEXT],
        systemInstruction: { parts: [{ text: `${SYSTEM_INSTRUCTION}\n\nCURRENT DASHBOARD CONTEXT:\n${contextBlock}` }] },
        tools: [{ functionDeclarations: GEMINI_TOOL_DEFINITIONS as unknown as never }],
      },
      callbacks: {
        onmessage: (msg) => this.handleMessage(msg),
        onerror: (err) => {
          this.logger.error({ event: 'GEMINI_ERROR', err });
          this.emit('error', err);
        },
        onclose: () => this.emit('close'),
        onopen: () => this.logger.log({ event: 'GEMINI_OPEN' }),
      },
    });
  }

  sendAudioChunk(buf: Buffer): void {
    if (!this.session) return;
    this.session.sendRealtimeInput({
      audio: { data: buf.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
    });
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }

  private handleMessage(msg: unknown): void {
    const m = msg as {
      serverContent?: { inputTranscription?: { text: string } };
      toolCall?: { functionCalls: { name: string; args: Record<string, unknown> }[] };
    };
    const transcript = m.serverContent?.inputTranscription?.text;
    if (transcript) {
      this.emit('transcript', transcript);
    }
    const toolCalls = m.toolCall?.functionCalls;
    if (toolCalls && toolCalls.length > 0) {
      this.emit('toolCall', toolCalls[0]);
    }
  }

  private renderContext(): string {
    const lines: string[] = [];
    if (this.context.pendingApprovals.length) {
      lines.push('Pending approvals:');
      for (const a of this.context.pendingApprovals) {
        lines.push(`  - id=${a.id} parent=${a.parentName} (${a.summary})`);
      }
    }
    if (this.context.todaySessions.length) {
      lines.push("Today's sessions:");
      for (const s of this.context.todaySessions) {
        lines.push(`  - id=${s.id} ${s.kidName} at ${s.time}`);
      }
    }
    if (this.context.parents.length) {
      lines.push('Known parents:');
      for (const p of this.context.parents) {
        lines.push(`  - ${p.name}`);
      }
    }
    return lines.join('\n');
  }
}
```

- [ ] **Step 3: Sanity-check the import compiles**

Run: `cd backend && pnpm build`
Expected: PASS (or at most a warning about the `as unknown as never` cast — accept it). If `Modality` or `Session` aren't exported from the SDK version installed, check the actual exports with `node -e "console.log(Object.keys(require('@google/genai')))"` and adjust imports accordingly.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/voice/gemini-live.client.ts
git commit -m "feat(voice): add GeminiLiveClient wrapper for Live API"
```

---

## Task 6: VoiceGateway — WS bridge between browser and Gemini

**Files:**
- Create: `backend/src/modules/voice/voice.gateway.ts`
- Test: `backend/src/modules/voice/voice.gateway.spec.ts`

The gateway:
1. Accepts upgrade on `/ws/coach-voice?token=<dashboard-token>`.
2. Validates the token with `timingSafeEqualStr` against `DASHBOARD_TOKEN`.
3. Pulls the latest dashboard context via `DashboardService.getHome` to seed Gemini.
4. Opens a `GeminiLiveClient`.
5. Pipes audio frames (browser → binary WS messages → Gemini).
6. Pipes events (Gemini transcript → text WS message; tool call → store proposal → send proposal WS message).
7. Cleans up on disconnect.

- [ ] **Step 1: Write a focused unit test for the upgrade-auth path**

Create `backend/src/modules/voice/voice.gateway.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { VoiceGateway } from './voice.gateway';
import { ConfigService } from '@nestjs/config';
import { CoachCommandService } from './coach-command.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { createServer } from 'node:http';
import WebSocket from 'ws';

describe('VoiceGateway upgrade auth', () => {
  let gateway: VoiceGateway;
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VoiceGateway,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (k: string) => {
              if (k === 'DASHBOARD_TOKEN') return 'a'.repeat(20);
              if (k === 'COACH_ID') return 'coach_1';
              if (k === 'GEMINI_API_KEY') return 'fake-key';
              if (k === 'VOICE_ENABLED') return true;
              throw new Error(k);
            },
            get: (k: string) => (k === 'VOICE_ENABLED' ? true : undefined),
          },
        },
        { provide: CoachCommandService, useValue: { storeProposal: jest.fn() } },
        {
          provide: DashboardService,
          useValue: {
            getHome: jest
              .fn()
              .mockResolvedValue({ approvals: [], sessions: [], fires: [], autoHandled: [], stats: { firesCount: 0, handledCount: 0 } }),
            getParents: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();
    gateway = moduleRef.get(VoiceGateway);

    server = createServer();
    gateway.attachToHttpServer(server);
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => {
    gateway.onModuleDestroy();
    server.close();
  });

  it('rejects connections without a token', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/coach-voice`);
    ws.on('error', () => done());
    ws.on('open', () => done.fail('should have been rejected'));
  });

  it('rejects connections with a wrong token', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/coach-voice?token=wrong`);
    ws.on('error', () => done());
    ws.on('open', () => done.fail('should have been rejected'));
  });

  it('accepts connections with the valid token', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/coach-voice?token=${'a'.repeat(20)}`);
    ws.on('open', () => { ws.close(); done(); });
    ws.on('error', (e) => done(e));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- voice.gateway`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gateway**

Create `backend/src/modules/voice/voice.gateway.ts`:

```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { CoachCommandService } from './coach-command.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { GeminiLiveClient } from './gemini-live.client';
import { toolCallToProposal } from './coach-command.types';

@Injectable()
export class VoiceGateway implements OnModuleDestroy {
  private readonly logger = new Logger(VoiceGateway.name);
  private wsServer: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly config: ConfigService,
    private readonly commands: CoachCommandService,
    private readonly dashboard: DashboardService,
  ) {}

  attachToHttpServer(server: HttpServer): void {
    if (this.wsServer) return;
    this.wsServer = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws/coach-voice') return;

      if (!this.config.get('VOICE_ENABLED')) {
        this.logger.warn({ event: 'VOICE_WS_REJECTED', reason: 'DISABLED' });
        socket.destroy();
        return;
      }

      const token = url.searchParams.get('token');
      const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
      if (!token || !timingSafeEqualStr(token, expected)) {
        this.logger.warn({ event: 'VOICE_WS_REJECTED', reason: 'AUTH' });
        socket.destroy();
        return;
      }

      this.wsServer!.handleUpgrade(request, socket, head, (ws) => {
        this.wsServer!.emit('connection', ws, request);
        void this.handleConnection(ws);
      });
    });
  }

  onModuleDestroy(): void {
    for (const c of this.clients) c.close();
    this.wsServer?.close();
  }

  private async handleConnection(ws: WebSocket): Promise<void> {
    const coachId = this.config.getOrThrow<string>('COACH_ID');
    const apiKey = this.config.getOrThrow<string>('GEMINI_API_KEY');
    this.clients.add(ws);

    const [home, parents] = await Promise.all([
      this.dashboard.getHome(coachId),
      this.dashboard.getParents(coachId),
    ]);

    const gemini = new GeminiLiveClient(apiKey, {
      pendingApprovals: home.approvals.map((a) => ({
        id: a.id, parentName: a.parent, summary: a.intent,
      })),
      todaySessions: home.sessions.map((s) => ({
        id: s.id, kidName: s.kid, time: s.time,
      })),
      parents: parents.map((p) => ({ id: p.id, name: p.name })),
    });

    gemini.on('transcript', (text: string) => {
      ws.send(JSON.stringify({ type: 'transcript', text }));
    });
    gemini.on('toolCall', (call: { name: string; args: Record<string, unknown> }) => {
      try {
        const proposal = toolCallToProposal(call.name, call.args);
        if (!proposal) {
          ws.send(JSON.stringify({ type: 'error', message: `Unknown tool: ${call.name}` }));
          return;
        }
        const stored = this.commands.storeProposal(coachId, proposal);
        ws.send(JSON.stringify({
          type: 'proposal',
          id: stored.id,
          expiresAt: stored.expiresAt.toISOString(),
          proposal: stored.proposal,
        }));
      } catch (err) {
        this.logger.error({ event: 'PROPOSAL_PARSE_FAILED', err });
        ws.send(JSON.stringify({
          type: 'error',
          message: err instanceof Error ? err.message : 'parse failed',
        }));
      }
    });
    gemini.on('error', (err: unknown) => {
      ws.send(JSON.stringify({
        type: 'error',
        message: err instanceof Error ? err.message : 'gemini error',
      }));
    });

    try {
      await gemini.open();
      ws.send(JSON.stringify({ type: 'ready' }));
    } catch (err) {
      this.logger.error({ event: 'GEMINI_OPEN_FAILED', err });
      ws.send(JSON.stringify({ type: 'error', message: 'failed to open voice session' }));
      ws.close();
      return;
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        gemini.sendAudioChunk(data as Buffer);
      }
      // Text messages from the browser are reserved for future control commands
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      gemini.close();
    });
  }
}
```

- [ ] **Step 4: Run the auth tests**

Run: `pnpm test -- voice.gateway`
Expected: PASS (3 specs).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/voice/voice.gateway.ts backend/src/modules/voice/voice.gateway.spec.ts
git commit -m "feat(voice): add VoiceGateway WS bridge with token auth"
```

---

## Task 7: VoiceController for confirm/cancel + VoiceModule wiring + main.ts

**Files:**
- Create: `backend/src/modules/voice/voice.controller.ts`
- Create: `backend/src/modules/voice/voice.module.ts`
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Implement the controller**

Create `backend/src/modules/voice/voice.controller.ts`:

```typescript
import { Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqualStr } from '../../common/timing-safe-equal';
import { CoachCommandService } from './coach-command.service';

@Controller('api/voice')
export class VoiceController {
  constructor(
    private readonly commands: CoachCommandService,
    private readonly config: ConfigService,
  ) {}

  private guard(token: string | undefined): string {
    const expected = this.config.getOrThrow<string>('DASHBOARD_TOKEN');
    if (!token || !timingSafeEqualStr(token, expected)) {
      throw new UnauthorizedException();
    }
    return this.config.getOrThrow<string>('COACH_ID');
  }

  @Post('proposals/:id/confirm')
  async confirm(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ): Promise<{ ok: true }> {
    const coachId = this.guard(token);
    await this.commands.confirm(id, coachId);
    return { ok: true };
  }

  @Post('proposals/:id/cancel')
  async cancel(
    @Param('id') id: string,
    @Headers('x-dashboard-token') token: string | undefined,
  ): Promise<{ ok: true }> {
    const coachId = this.guard(token);
    this.commands.cancel(id, coachId);
    return { ok: true };
  }
}
```

- [ ] **Step 2: Implement the module**

Create `backend/src/modules/voice/voice.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { VoiceGateway } from './voice.gateway';
import { VoiceController } from './voice.controller';
import { CoachCommandService } from './coach-command.service';
import { DashboardModule } from '../dashboard/dashboard.module';

@Module({
  imports: [DashboardModule],
  providers: [VoiceGateway, CoachCommandService],
  controllers: [VoiceController],
  exports: [VoiceGateway],
})
export class VoiceModule {}
```

You will need to export `DashboardService` from `DashboardModule` if it isn't already — open `backend/src/modules/dashboard/dashboard.module.ts` and add `exports: [DashboardService]`.

- [ ] **Step 3: Register VoiceModule**

In `backend/src/app.module.ts`, add `VoiceModule` to the imports list (alongside `DashboardModule`, `TwilioModule`, etc.) with the import statement at the top.

- [ ] **Step 4: Wire the WS gateway to the HTTP server**

In `backend/src/main.ts`, after the existing `webChatGateway.attachToHttpServer(...)` line (or wherever the HTTP server is exposed), add:

```typescript
const voiceGateway = app.get(VoiceGateway);
const httpServer = app.getHttpServer() as import('node:http').Server;
voiceGateway.attachToHttpServer(httpServer);
```

(If `webChatGateway` already grabs the HTTP server, reuse the same handle.)

- [ ] **Step 5: Run all backend tests**

Run: `cd backend && pnpm test`
Expected: PASS.

- [ ] **Step 6: Manual sanity check — the server boots**

```bash
cd backend && VOICE_ENABLED=true GEMINI_API_KEY=test-key pnpm start:dev
```

Expected: server boots without throwing; logs show `Nest application successfully started`. Hit `curl -i -H 'x-dashboard-token: <token>' -X POST http://localhost:3002/api/voice/proposals/prop_doesnotexist/confirm` and expect a 404.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/voice/voice.controller.ts backend/src/modules/voice/voice.module.ts backend/src/modules/dashboard/dashboard.module.ts backend/src/app.module.ts backend/src/main.ts
git commit -m "feat(voice): wire VoiceModule, controller, and HTTP server attach"
```

---

## Task 8: Frontend — PCM audio capture worklet

**Files:**
- Create: `frontend/src/lib/voice/pcm-worklet.js` (lives in `public/` actually — must be served as a static asset, since AudioWorklet needs a real URL)
- Create: `frontend/public/pcm-worklet.js` ← put it here instead
- Create: `frontend/src/lib/voice/audio-capture.ts`

- [ ] **Step 1: Create the AudioWorklet processor**

Create `frontend/public/pcm-worklet.js` (plain JS, no TS — runs in worklet context):

```javascript
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this._inputSampleRate = sampleRate; // global in AudioWorklet
    this._targetSampleRate = 16000;
    this._ratio = this._inputSampleRate / this._targetSampleRate;
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    // Naive linear-rate downsample
    let i = 0;
    while (i < ch.length) {
      const idx = Math.floor(i);
      this._buffer.push(ch[idx]);
      i += this._ratio;
    }

    // Flush ~20ms chunks (320 samples at 16kHz)
    while (this._buffer.length >= 320) {
      const chunk = this._buffer.splice(0, 320);
      const pcm = new Int16Array(chunk.length);
      for (let j = 0; j < chunk.length; j += 1) {
        const s = Math.max(-1, Math.min(1, chunk[j]));
        pcm[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}

registerProcessor('pcm-downsampler', PcmDownsampler);
```

- [ ] **Step 2: Create the capture wrapper**

Create `frontend/src/lib/voice/audio-capture.ts`:

```typescript
export interface AudioCapture {
  start(onChunk: (buf: ArrayBuffer) => void): Promise<void>;
  stop(): void;
}

export function createAudioCapture(): AudioCapture {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;

  return {
    async start(onChunk) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule('/pcm-worklet.js');
      const source = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'pcm-downsampler');
      node.port.onmessage = (ev) => onChunk(ev.data as ArrayBuffer);
      source.connect(node);
      // Don't connect node→destination — we don't want to play it back
    },
    stop() {
      node?.disconnect();
      node = null;
      ctx?.close();
      ctx = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    },
  };
}
```

- [ ] **Step 3: Visual smoke check (no automated test — frontend has no test runner)**

This task has no test runner. You'll verify it works during Task 10's manual smoke test.

- [ ] **Step 4: Commit**

```bash
git add frontend/public/pcm-worklet.js frontend/src/lib/voice/audio-capture.ts
git commit -m "feat(voice/web): add 16kHz PCM AudioWorklet capture"
```

---

## Task 9: Frontend — useVoiceSession hook

**Files:**
- Create: `frontend/src/lib/voice/use-voice-session.ts`
- Modify: `frontend/src/lib/api.ts` (add proposal types + confirm/cancel helpers)

- [ ] **Step 1: Add types and API helpers**

In `frontend/src/lib/api.ts`, add these types near the top of the types section:

```typescript
export type VoiceProposal =
  | { kind: 'APPROVE_PENDING'; approvalId: string; summary: string }
  | { kind: 'DISMISS_PENDING'; approvalId: string; summary: string }
  | { kind: 'DRAFT_REPLY'; parentName: string; messageBody: string; summary: string }
  | { kind: 'BLOCK_AVAILABILITY'; startAtIso: string; endAtIso: string; summary: string }
  | { kind: 'CANCEL_SESSION'; sessionId: string; summary: string };

export interface StoredVoiceProposal {
  id: string;
  expiresAt: string;
  proposal: VoiceProposal;
}
```

Add to the `api` object:

```typescript
  confirmVoiceProposal: (id: string) =>
    apiFetch<{ ok: true }>(`/api/voice/proposals/${id}/confirm`, { method: 'POST' }),
  cancelVoiceProposal: (id: string) =>
    apiFetch<{ ok: true }>(`/api/voice/proposals/${id}/cancel`, { method: 'POST' }),
  cancelSession: (id: string) =>
    apiFetch<void>(`/api/dashboard/sessions/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 2: Create the hook**

Create `frontend/src/lib/voice/use-voice-session.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioCapture, type AudioCapture } from './audio-capture';
import type { StoredVoiceProposal } from '../api';

const apiUrl = (import.meta.env.VITE_API_URL as string) ?? 'http://localhost:3002';
const token = (import.meta.env.VITE_DASHBOARD_TOKEN as string) ?? '';

type ServerEvent =
  | { type: 'ready' }
  | { type: 'transcript'; text: string }
  | { type: 'proposal'; id: string; expiresAt: string; proposal: StoredVoiceProposal['proposal'] }
  | { type: 'error'; message: string };

export interface VoiceSession {
  isHolding: boolean;
  isReady: boolean;
  transcript: string;
  proposal: StoredVoiceProposal | null;
  error: string | null;
  startHold: () => Promise<void>;
  stopHold: () => void;
  clearProposal: () => void;
}

function wsUrl(): string {
  const u = new URL(apiUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/ws/coach-voice';
  u.searchParams.set('token', token);
  return u.toString();
}

export function useVoiceSession(): VoiceSession {
  const [isHolding, setIsHolding] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [proposal, setProposal] = useState<StoredVoiceProposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);

  const teardown = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    setIsHolding(false);
    setIsReady(false);
  }, []);

  const startHold = useCallback(async () => {
    setError(null);
    setTranscript('');
    setProposal(null);

    const ws = new WebSocket(wsUrl());
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as ServerEvent;
        if (msg.type === 'ready') setIsReady(true);
        else if (msg.type === 'transcript') setTranscript((t) => t + msg.text);
        else if (msg.type === 'proposal') {
          setProposal({ id: msg.id, expiresAt: msg.expiresAt, proposal: msg.proposal });
          teardown();
        } else if (msg.type === 'error') setError(msg.message);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'parse error');
      }
    };
    ws.onerror = () => setError('voice connection error');
    ws.onclose = () => { setIsHolding(false); setIsReady(false); };

    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      const t = setTimeout(() => rej(new Error('ws open timeout')), 5000);
      ws.addEventListener('open', () => clearTimeout(t));
    });

    const capture = createAudioCapture();
    await capture.start((buf) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(buf);
    });
    captureRef.current = capture;
    setIsHolding(true);
  }, [teardown]);

  const stopHold = useCallback(() => teardown(), [teardown]);
  const clearProposal = useCallback(() => setProposal(null), []);

  useEffect(() => () => teardown(), [teardown]);

  return { isHolding, isReady, transcript, proposal, error, startHold, stopHold, clearProposal };
}
```

- [ ] **Step 3: Frontend lints**

Run: `cd frontend && pnpm lint`
Expected: PASS or only style warnings.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/voice/use-voice-session.ts
git commit -m "feat(voice/web): add useVoiceSession hook + API helpers"
```

---

## Task 10: Frontend — VoiceButton, VoiceOverlay, VoiceConfirmationCard, wire into Home

**Files:**
- Create: `frontend/src/components/voice/voice-button.tsx`
- Create: `frontend/src/components/voice/voice-overlay.tsx`
- Create: `frontend/src/components/voice/voice-confirmation-card.tsx`
- Modify: `frontend/src/components/screens/home.tsx`

- [ ] **Step 1: Build VoiceButton**

Create `frontend/src/components/voice/voice-button.tsx`:

```tsx
import { Mic } from 'lucide-react';
import { useVoiceSession } from '../../lib/voice/use-voice-session';
import { VoiceOverlay } from './voice-overlay';
import { VoiceConfirmationCard } from './voice-confirmation-card';

export function VoiceButton() {
  const v = useVoiceSession();

  const onPointerDown = () => { void v.startHold(); };
  const onPointerUp = () => { v.stopHold(); };

  return (
    <>
      <button
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        aria-label="Hold to talk"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: v.isHolding ? '#C2410C' : '#1f2937',
          color: '#F7F3EC',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 120ms ease',
          touchAction: 'none',
        }}
      >
        <Mic size={20} />
      </button>
      {v.isHolding && <VoiceOverlay transcript={v.transcript} ready={v.isReady} />}
      {v.proposal && (
        <VoiceConfirmationCard
          stored={v.proposal}
          onClose={v.clearProposal}
        />
      )}
      {v.error && (
        <div style={{ position: 'fixed', top: 16, right: 16, background: '#7f1d1d', color: 'white', padding: 12, borderRadius: 8, zIndex: 80 }}>
          {v.error}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Build VoiceOverlay**

Create `frontend/src/components/voice/voice-overlay.tsx`:

```tsx
export function VoiceOverlay({ transcript, ready }: { transcript: string; ready: boolean }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        zIndex: 70,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          width: 96, height: 96, borderRadius: 48,
          background: ready ? '#C2410C' : '#374151',
          animation: 'voicePulse 1.4s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes voicePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.7; }
        }
      `}</style>
      <div style={{ color: '#F7F3EC', fontFamily: 'Geist Mono, monospace', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {ready ? 'Listening' : 'Connecting…'}
      </div>
      <div style={{ color: '#F7F3EC', fontFamily: 'Inter Tight, sans-serif', fontSize: 18, maxWidth: 560, textAlign: 'center', minHeight: 24 }}>
        {transcript || ' '}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build VoiceConfirmationCard**

Create `frontend/src/components/voice/voice-confirmation-card.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type StoredVoiceProposal } from '../../lib/api';

function describe(p: StoredVoiceProposal['proposal']): { title: string; body: string } {
  switch (p.kind) {
    case 'APPROVE_PENDING':
      return { title: 'Approve pending reply', body: p.summary };
    case 'DISMISS_PENDING':
      return { title: 'Dismiss pending reply', body: p.summary };
    case 'DRAFT_REPLY':
      return { title: `Reply to ${p.parentName}`, body: p.messageBody };
    case 'BLOCK_AVAILABILITY':
      return {
        title: 'Block availability',
        body: `${new Date(p.startAtIso).toLocaleString()} → ${new Date(p.endAtIso).toLocaleString()}`,
      };
    case 'CANCEL_SESSION':
      return { title: 'Cancel session', body: p.summary };
  }
}

export function VoiceConfirmationCard({
  stored,
  onClose,
}: {
  stored: StoredVoiceProposal;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useMutation({
    mutationFn: () => api.confirmVoiceProposal(stored.id),
    onSuccess: () => {
      void qc.invalidateQueries();
      onClose();
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelVoiceProposal(stored.id),
    onSuccess: onClose,
  });

  const { title, body } = describe(stored.proposal);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#0E0F0C', border: '1px solid #2A2B27', borderRadius: 24, padding: 24, maxWidth: 480, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div style={{ fontFamily: 'Geist Mono, monospace', fontSize: 11, letterSpacing: '0.1em', color: '#A8A49B', textTransform: 'uppercase' }}>
          Confirm voice command
        </div>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, color: '#F7F3EC' }}>{title}</div>
        <div style={{ fontFamily: 'Inter Tight, sans-serif', fontSize: 15, color: '#D4D0C7', whiteSpace: 'pre-wrap' }}>{body}</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending || confirm.isPending}
            style={{ flex: 1, padding: '12px 16px', background: 'transparent', border: '1px solid #2A2B27', color: '#F7F3EC', borderRadius: 12, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={() => confirm.mutate()}
            disabled={confirm.isPending || cancel.isPending}
            style={{ flex: 1, padding: '12px 16px', background: '#C2410C', border: 'none', color: '#F7F3EC', borderRadius: 12, cursor: 'pointer' }}
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render the button in HomeScreen**

In `frontend/src/components/screens/home.tsx`, import:

```tsx
import { VoiceButton } from '../voice/voice-button';
```

Find the header section (the area near the top with the theme toggle / sun/moon button) and add `<VoiceButton />` next to the theme toggle. Choose a placement that visually matches the existing header buttons.

- [ ] **Step 5: Lint**

Run: `cd frontend && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/voice frontend/src/components/screens/home.tsx
git commit -m "feat(voice/web): add hold-to-talk button, overlay, and confirmation card"
```

---

## Task 11: End-to-end manual smoke test

This is a manual task. There is no automated runner for the full voice path because Gemini Live cannot be cheaply mocked.

**Files:** none changed.

- [ ] **Step 1: Boot everything**

```bash
# terminal 1
docker compose up

# terminal 2
cd backend && \
  VOICE_ENABLED=true \
  GEMINI_API_KEY=<your real key> \
  pnpm start:dev

# terminal 3
cd backend && pnpm start:worker:dev

# terminal 4
cd frontend && pnpm dev
```

- [ ] **Step 2: Open http://localhost:5173 in Chrome**

Grant microphone permission when prompted.

- [ ] **Step 3: Seed fixtures so there is something to act on**

```bash
cd backend && pnpm db:seed
```

Confirm the dashboard shows ≥ 1 pending approval, ≥ 1 today session.

- [ ] **Step 4: Test the APPROVE_PENDING path**

Hold the mic button. Say: "Approve the pending reply to <parent name>." Release.

Expected:
- Overlay shows "Listening" then transcript appears
- Card pops up: "Approve pending reply"
- Click Confirm
- The pending approval count drops by 1; an `agentDecision` row gets written; an outbound message is sent.

- [ ] **Step 5: Test BLOCK_AVAILABILITY**

Hold and say: "Block off tomorrow from 6pm to 7pm." Release.

Expected: Card shows the parsed window. Confirming inserts an Availability row.

- [ ] **Step 6: Test CANCEL_SESSION**

Hold and say: "Cancel the 4pm session today." Release.

Expected: Card identifies the session by id from the dashboard context. Confirming sets `status = CANCELLED`.

- [ ] **Step 7: Test the safety gate — refuse to execute without confirmation**

Repeat any flow above but click Cancel instead of Confirm. Verify nothing changed in the database (queue Postgres directly with `docker compose exec postgres psql -U coach coach_local -c "select id, status from \"Session\" order by \"scheduledAt\" desc limit 5;"`).

- [ ] **Step 8: Commit any tweaks**

If you had to adjust anything during smoke-testing, commit:

```bash
git add -A
git commit -m "fix(voice): smoke-test fixes"
```

- [ ] **Step 9: Update the implementation log**

Append a one-paragraph note to `docs/superpowers/plans/2026-04-25-phase-6-voice.md` at the bottom describing what worked, what didn't, and any follow-ups (e.g., "Gemini sometimes returns no tool call for ambiguous speech — surface a 'try again' message"). This becomes the handoff to whoever picks up Phase 7.

---

## Out of Scope (explicit)

These are deliberately NOT in this plan:

- **Voice as a parent input channel.** Phase 6 covers coach-side voice only. Inbound parent voicemail-via-Twilio (which would feed transcripts into the existing `MessagesService.ingest` flow as `Channel.VOICE`) is a separate plan.
- **Gemini outputting audio.** We use TEXT-only response modality. The coach reads / sees the proposal, doesn't hear it. Adding TTS feedback is a polish task in Phase 7.
- **Wake word / always-listening.** Hold-to-talk only — explicit user gesture every time.
- **Streaming partial proposals.** Each utterance produces at most one proposal at the end.
- **Background tab support.** AudioWorklet won't run if the tab is backgrounded. We don't try to keep the session alive.

---

## Self-review notes

**Spec coverage:**
- "Gemini Live integration on coach dashboard" → Tasks 5, 6, 7
- "Hold-to-talk mic button" → Task 10
- "Transcription shows live" → Task 6 (transcript event) + Task 9 (overlay)
- "Voice commands route through state machine (same as text, just different transport)" → Task 3 (`CoachCommandService.dispatch` calls `DashboardService` methods that are the same ones used by the text/UI flow)
- "Every voice-initiated action shows visual confirmation card before executing" → Task 3 (TTL store), Task 7 (controller), Task 10 (`VoiceConfirmationCard`); proposals are stored, never auto-executed
- "Do not let voice become its own agent" → Gemini is constrained to tool-calls only (Task 5 system instruction + tool list), backend rejects unknown tool names (Task 2 `toolCallToProposal` returns null), nothing executes without an explicit POST from the browser (Task 7)

### Implementation Log

Voice routing, proposal storage, dashboard dispatch, and the frontend hold-to-talk flow are wired up and compile successfully. I verified the new backend confirm route returns `404` for an unknown proposal and the frontend build passes. The full frontend lint run still reports unrelated baseline issues in pre-existing files, and the backend full test suite has unrelated failures in agent/demo-chat specs that predate the voice work. Next follow-up is a real Gemini Live smoke test with a valid API key and microphone input, plus cleanup of the unrelated lint/test debt if the team wants a fully green repo.
