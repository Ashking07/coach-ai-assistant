# Coach Dashboard — Implementation Design

**Date:** 2026-04-23  
**Branch:** phase-2-message-ingestion  
**Scope:** Implement the Figma Make coach dashboard design into the existing React/Vite/Tailwind frontend and connect it to the NestJS backend.

---

## Overview

Replace the placeholder frontend with the full coach dashboard from Figma Make (`qVHr7CpnwwdR7ZVjUKH5mG`). Add a new `DashboardModule` to the backend that exposes read/write endpoints for the four dashboard screens. Auth uses a static API key (`DASHBOARD_TOKEN`) validated with the existing `timingSafeEqualStr` helper.

The product is a solo-coach tool. All queries are scoped to a single `COACH_ID` env var — no multi-tenancy.

---

## Backend

### Migration

Add `autonomyEnabled Boolean @default(true)` to the `Coach` model in `prisma/schema.prisma`. Run `pnpm prisma migrate dev --name add-coach-autonomy-enabled`.

### DashboardModule

Location: `backend/src/modules/dashboard/`

Files:
- `dashboard.module.ts` — imports `PrismaModule`, registered in `AppModule`
- `dashboard.controller.ts` — validates `x-dashboard-token` header using `timingSafeEqualStr` against `DASHBOARD_TOKEN` env var; thin routing only
- `dashboard.service.ts` — all Prisma queries; no business logic

### Endpoints

All routes are prefixed `/api/dashboard`. All require `x-dashboard-token` header. All queries are scoped to `COACH_ID` from env.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dashboard/home` | Fires (escalated AgentDecisions last 24h with parent+kid), pending ApprovalQueue rows (with message+parent+kid), today's Sessions (with kid+parent) |
| `GET` | `/api/dashboard/audit` | Most recent 100 AgentDecision rows with message+parent+kid, newest first |
| `GET` | `/api/dashboard/parents` | All Parents with their Kids + last message receivedAt |
| `GET` | `/api/dashboard/settings` | Coach record (name, phone, timezone, stripeAccountId, autonomyEnabled) |
| `PATCH` | `/api/dashboard/settings` | Update `autonomyEnabled` (and other editable fields) |
| `POST` | `/api/dashboard/approvals/:id/send` | Set `ApprovalQueue.status = APPROVED`, `resolvedAt = now`, `resolvedBy = 'coach'` |
| `POST` | `/api/dashboard/approvals/:id/dismiss` | Set `ApprovalQueue.status = REJECTED`, `resolvedAt = now`, `resolvedBy = 'coach'` |

### Data shapes (home endpoint detail)

```ts
// GET /api/dashboard/home
{
  fires: Array<{
    id: string;           // AgentDecision.id
    parent: string;       // Parent.name
    kid: string;          // Kid.name (first kid of parent, or "—")
    reason: string;       // AgentDecision.actionTaken
    ago: string;          // relative time string (e.g. "2h 14m")
    preview: string;      // Message.content (truncated to 120 chars)
    intent: string;       // AgentDecision.intent
  }>;
  approvals: Array<{
    id: string;           // ApprovalQueue.id
    parent: string;       // Parent.name
    kid: string;          // Kid.name
    intent: string;       // AgentDecision.intent
    incoming: string;     // Message.content
    draft: string;        // ApprovalQueue.draftReply
    confidence: number;   // AgentDecision.confidence
    ago: string;          // relative time from ApprovalQueue.createdAt
    reason: string;       // AgentDecision.reasoning (truncated)
  }>;
  sessions: Array<{
    id: string;           // Session.id
    kid: string;          // Kid.name
    time: string;         // HH:MM from Session.scheduledAt
    duration: string;     // e.g. "60m"
    note: string;         // Session.coachNotes
    paid: boolean;        // Session.paid
  }>;
  autoHandled: Array<{
    id: string;           // AgentDecision.id
    parent: string;       // Parent.name (abbreviated)
    kid: string;          // Kid.name
    intent: string;       // AgentDecision.intent
    summary: string;      // first sentence of AgentDecision.reasoning
    time: string;         // HH:MM from AgentDecision.createdAt
  }>;
  stats: {
    firesCount: number;
    handledCount: number; // auto-sent decisions in last 24h
  };
}
```

---

## Frontend

### Environment variables

```
VITE_API_URL=http://localhost:3002
VITE_DASHBOARD_TOKEN=<same value as DASHBOARD_TOKEN>
```

### File structure

```
frontend/src/
  tokens.ts                     — color tokens + CSS variable maps for dark/light themes
  lib/
    api.ts                      — typed fetch functions, sends x-dashboard-token on every request
  components/
    side-nav.tsx                — desktop left sidebar (Home, Audit, Parents, Settings icons)
    bottom-tab-bar.tsx          — mobile bottom nav
    avatar.tsx                  — KidAvatar (initials + deterministic background color)
    badges.tsx                  — IntentBadge, TierBadge
    cards.tsx                   — FireCard, ApprovalCard, SessionCard
    approval-detail.tsx         — full-screen slide-up approval detail with send/dismiss
    screens/
      home.tsx                  — greeting, fires, approvals, sessions, auto-handled
      audit.tsx                 — filterable decision log (All/Auto-sent/Approved/Escalated)
      parents.tsx               — family directory with search
      settings.tsx              — autonomy toggle + read-only coach profile fields
  App.tsx                       — theme state, tab routing, CSS variable injection
```

### Data fetching

| Hook | Endpoint | Refetch interval |
|------|----------|-----------------|
| `useHome()` | `GET /api/dashboard/home` | 30s |
| `useAudit()` | `GET /api/dashboard/audit` | on focus |
| `useParents()` | `GET /api/dashboard/parents` | on focus |
| `useSettings()` | `GET /api/dashboard/settings` | on focus |
| `useSendApproval()` | `POST /api/dashboard/approvals/:id/send` | mutation |
| `useDismissApproval()` | `POST /api/dashboard/approvals/:id/dismiss` | mutation |
| `useUpdateSettings()` | `PATCH /api/dashboard/settings` | mutation |

Mutations optimistically remove/update the relevant item from the cache immediately. On failure, the cache is rolled back.

### Theme

Dark by default. CSS variables (`--bg`, `--panel`, `--text`, `--muted`, `--hairline`, `--surface-sub`, `--panel-solid`) injected inline on the root `div` in `App.tsx`. Toggle persisted to `localStorage`. Fonts loaded via Google Fonts in `index.html`: **Fraunces** (serif headlines), **Geist Mono** (monospace metadata), **Inter Tight** (body).

### Auth

`VITE_DASHBOARD_TOKEN` sent as `x-dashboard-token` header on every API request via a central `apiFetch` wrapper in `lib/api.ts`.

---

## Error handling & loading states

- **Loading**: skeleton pulsing placeholders per screen section; sections load independently
- **Errors**: inline error banner per screen with a retry button (`refetch`)
- **Optimistic updates**: approval cards disappear immediately on send/dismiss; reappear on failure
- **Empty states**: "Inbox is quiet. Nothing needs you right now." when fires + approvals both empty
- **Audit limit**: fetch most recent 100 decisions; no pagination for MVP

---

## Out of scope

- Real SMS sending via Twilio (approval send just marks DB status)
- Agent autonomy flag wired into the pipeline (stored in DB, shown in UI, not yet read by worker)
- Pagination on audit log
- Coach login / JWT auth (using static API key)
- Parents detail screen / kid profiles
