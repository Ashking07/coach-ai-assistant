# Demo Script

**App:** Coach AI Assistant — agentic attention management for solo sports coaches  
**URL:** http://localhost:5173  (or the Render URL for live demo)  
**Time:** ~8 min

---

## Setup (before the room fills)

1. `docker compose up -d` — Postgres + Redis
2. `pnpm start:dev` (backend, port 3002) + `pnpm start:worker:dev` (BullMQ worker)
3. `pnpm dev` (frontend, port 5173)
4. Open the app on a laptop **and** on your phone (same local network or Render URL)
5. Optional: open a second browser tab at the Demo Parent chat screen (`/demo` route or the QR card on Home)

---

## Act 1 — The Problem (30 s)

> "A solo coach gets 40–60 parent messages a day. Every one of them needs a reply, but not all of them need the coach's attention. Right now the coach handles all of it manually."

Show the **Home** tab — queue of pending approvals, each one a parent message with a drafted reply already waiting.

---

## Act 2 — Inbound message → auto-reply (2 min)

1. Switch to the **Demo Parent** chat (QR card on Home, or tap the demo tab).
2. Type: `Are you free Thursday at 4pm?`
3. Switch back to **Home** — a new card appears in the queue tagged `AUTO` (green badge).
   - Point out: intent classified as `QUESTION_LOGISTICS`, confidence ≥ 0.7, coach is a known parent → auto tier
   - The drafted reply references actual availability from the calendar
4. Type a booking request: `Can we book Friday at 3pm?`
   - A new card appears tagged `APPROVE` — the agent drafted a reply but wants the coach to confirm before sending, because booking requires a human sign-off.
5. Tap the card → **Approval Detail** overlay
   - Show the incoming message, intent, confidence score, and the drafted reply
   - Tap **Send** → card disappears, reply "sent" (demo channel)

---

## Act 3 — Escalation (45 s)

1. In Demo Parent, type: `I think the rate is too high, can we discuss?`
2. Back on Home — card appears tagged `ESCALATE` (red badge), reason: *Sensitive keyword detected*
3. Point out: the agent never drafted a reply for this — it surfaced it directly. Coach handles these personally.

---

## Act 4 — Voice commands (2 min)

Tap the **mic button** (bottom-right of Home screen, or top-right).

> "The coach can manage the entire schedule hands-free between sessions."

Try these one at a time (speak naturally, confirm each card):

- `"Block Tuesday 2pm to 4pm"` → availability blocked, shows in week view
- `"Mark Wednesday 10am available"` → open slot added
- `"Put Rhea on the schedule for tomorrow at 5pm"` → session created, appears in week view

Each command shows a confirmation card — tap **Confirm** or **Cancel**.

---

## Act 5 — Session recap (1 min)

Go to the **Home** tab, scroll to the week view, find a session card (e.g. today's session).

1. Tap the **mic icon** on the session card → SESSION RECAP modal opens, recording starts
2. Speak: `"Great session today, Rhea's backhand is really clicking, she stayed focused the whole hour"`
3. Tap **Stop & Submit** → spinner → green checkmark
4. Switch to **Audit** tab → a new approval card appears with a polished parent-friendly recap drafted by Claude, ready to send

---

## Act 6 — Kill switch + Audit (45 s)

1. Go to **Settings** → toggle **Agent Paused** → all incoming messages are queued without processing, coach gets full control back instantly
2. Toggle it back on
3. Go to **Audit** tab → filter by `Auto-sent` to show everything the agent handled without interrupting the coach
   - Each entry shows: incoming message, intent, confidence, draft sent, latency

---

## Key numbers to mention

| | |
|---|---|
| Auto-handled (typical) | ~60% of messages |
| Coach approval required | ~30% (bookings, ambiguous) |
| Escalated to coach | ~10% (payment, complaints, unknowns) |
| Recap → parent message | < 5 s end-to-end |

---

## If something breaks

| Symptom | Fix |
|---|---|
| No AI reply in demo chat | Worker not running — `pnpm start:worker:dev` |
| Voice "No command recognized" | Stale backend process — `lsof -ti :3002 \| xargs kill -9` then restart |
| Recap endpoint 500 | Check `ANTHROPIC_API_KEY` is set in `backend/.env` |
| Queue empty / cards not appearing | Redis down — `docker compose up -d redis` |
