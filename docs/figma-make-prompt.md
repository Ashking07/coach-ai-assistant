# Figma Make Prompt — Coach Cockpit

## The product (read this first, it shapes every pixel)

Design a **coach cockpit** — not a CRM, not a dashboard, not an inbox. It is an agentic attention-management system for **one elite solo coach** who trains Olympic-track kids at $200/session and manages ~50 parents with pen and paper today. Routine parent messages (booking, logistics, reschedules) are handled autonomously by an AI agent behind the scenes. The coach only sees the UI when something actually needs a human — an approval tap, an escalation, or their morning/evening triage.

The product's thesis, taped to the wall:
> *An agentic attention-management system for elite solo coaches — handling routine parent communication transparently, surfacing only what genuinely needs the coach's decision.*

Every screen answers one of three questions in this order:
1. **What needs me right now?** (fires — escalations, blocked approvals aging past 2h)
2. **What's on my plate today?** (today's sessions, pending approvals, unread follow-ups)
3. **What did the agent already handle on my behalf?** (audit log, auto-sent replies — transparent, never hidden)

This is a tool for a human being who coaches kids for a living. It must feel **calm, confident, athletic, premium, human**. Never SaaS-generic. Never inbox-anxiety-inducing. Never "Jira for parents."

## Who uses it

- **Primary user:** one coach, mobile-first. They check between sessions — from the court, the pool deck, the parking lot. Interactions are 10–30 seconds long. One-handed. Glanceable.
- **Secondary surface:** desktop for morning/evening planning (15-min ritual) and session-recap work.
- This demo is mobile-web (PWA-bookmarked to home screen) + responsive desktop. One codebase, two breakpoints. No separate app.

## Design direction

**Mood references (do not copy — borrow the feeling):**
- **Linear** — calm density, keyboard-first, every pixel earns its place
- **Things 3** — warm, respectful of the user's attention, friendly empty states
- **Superhuman** — triage-first mental model, inbox is an outcome not a place
- **WHOOP / Tonal app** — athletic, premium, confident (this coach's world)
- **Arc browser** — moments of delight, not gratuitous animation
- Not: Salesforce, HubSpot, Intercom, generic admin template

**Visual tone:** this is a crafted object, not a stamped-out admin panel. Use an editorial touch — a serif in one or two places (page titles, time-of-day greeting), humanist sans everywhere else. Generous spacing. Real hierarchy.

## Color palette (locked — use exactly these)

Warm, athletic, cockpit-like. **Not** cold corporate blue. **Not** health-tech mint.

**Dark mode (default, cockpit feel):**
- `#0E0F0C` — ink (background)
- `#17181480` — panel (elevated surface, translucent on ink)
- `#F7F3EC` — ivory (primary text on ink)
- `#A8A49B` — muted text (secondary)
- `#2A2B27` — hairline borders

**Light mode (daylight, morning planning):**
- `#F7F3EC` — ivory (background, warm paper, NOT pure white)
- `#FFFFFF` — card surface
- `#0E0F0C` — ink (primary text)
- `#6B6860` — muted text
- `#E6E1D7` — hairline borders

**Accent (use sparingly, one hero signal):**
- `#E26A2C` — sunrise amber (primary CTA, active state, focus ring) — evokes morning practice, stadium light, focused heat

**Tier semantics (this is the product's entire emotional vocabulary — get it right):**
- **AUTO / handled** — `#7A8B6E` moss — calm, "nothing to see, I took care of it"
- **APPROVE / needs a tap** — `#E2A13C` warm amber — friendly invitation, not alarm
- **ESCALATE / needs your brain** — `#C85A3E` terracotta — urgent, human, never harsh red
- **INFO / neutral audit** — `#8A857B` stone

Never use pure green (#00FF…), pure red, or pure blue. Every accent is muted, earthy, warm.

## Typography

- **Display / page titles / time-of-day greeting:** Fraunces (editorial serif, soft optical size). Used sparingly — one per screen max.
- **UI:** Inter Tight or Geist Sans, weight 400/500/600.
- **Numbers / timestamps / metrics:** Geist Mono or IBM Plex Mono, tabular figures.
- Base size 15–16px mobile, 14–15px desktop. Never smaller than 13 for body.

## Core screens to design (in this order)

### 1. Home / Triage (the first screen when the coach opens the app)

Mobile-first layout. Top to bottom:

1. **Greeting strip.** Serif, one line: "Tuesday morning, Coach." + tiny caption below in mono showing how many fires and how many auto-handled messages since last visit ("3 need you · 47 handled overnight"). This is the product's whole promise in one glance.
2. **Fires section** (only shown if non-empty). Label: "Needs you." Cards for each escalation — parent name, kid name, reason tag ("payment question", "new parent", "policy"), timestamp, one-line preview of the parent's message, two buttons: "Open" (full context) and "Dismiss". Terracotta left border.
3. **Approvals section.** Label: "Drafted for your tap." Cards showing parent+kid avatar initials, intent badge (BOOK / RESCHEDULE / QUESTION), the agent's drafted reply in full, two buttons: "Send" (amber, primary) and "Edit". Amber left border. Each card has a tiny "why this tier" disclosure on tap — shows confidence score, policy gate result.
4. **Today's sessions.** Horizontal scrollable cards. Kid name big, time, one coach note. Tap opens session detail.
5. **Auto-handled** (collapsed by default, expandable). "47 handled overnight" → tap reveals compact list of who got what reply, with timestamps. Moss-colored subtle accent. This section is the demo's credibility moment: the coach can audit everything the agent did.

### 2. Approval detail / Message thread

Full-thread view when the coach taps an approval or fire.

- Thread bubbles: parent (ivory bubble, left-aligned), agent (moss-tinted, right, labeled "agent draft" if not yet sent, "sent by agent" if auto-sent), coach (amber, right, when coach sends directly).
- Bottom: the agent's current draft, fully editable inline, with a **tier badge** ("APPROVE · 0.87 confidence · known parent · slot available") that expands into the full decision trace: classify → policy gate → confidence gate → draft → (validation).
- Action bar: [Send], [Edit], [Escalate to me — don't send], [Reply manually].
- Side panel (desktop only, collapsible): parent profile — kid(s), recent sessions, payment status, preferred channel, notes.

### 3. Audit log (the demo centerpiece)

A time-sorted append-only feed of every agent decision. Think: **Stripe dashboard's event log, but warm.**

- Each row: timestamp (mono), parent+kid, intent badge, tier badge (moss/amber/terracotta), action taken ("AUTO_SENT", "QUEUED_FOR_APPROVAL", "ESCALATED"), LLM model + token count + latency in mono text, expand chevron.
- Expanded row shows the parent message, the draft, the full reasoning chain, the policy gate verdict, and (if sent) the outbound message content.
- Filter chips at top: All / Auto-sent / Approved / Escalated / Failed. Date range.
- This screen is where Kaplan (the judge) sees the architecture. Make it feel **engineered** — monospaced timestamps, precise spacing, no decoration. Calm.

### 4. Session detail

One kid, one session. Scheduled time, duration, paid/unpaid, payment method, Stripe link (if unpaid), coach notes (rich text), history strip of past sessions with this kid.

Post-session: a voice-note button (pill-shaped, amber). Hold to record; release triggers agent to draft a parent-friendly recap. Recap appears as an approval card on home.

### 5. Kill switch + settings

A discreet screen. One prominent toggle: **"Agent autonomy: ON."** When off, nothing auto-sends — everything becomes an approval. Above it, a calm explanatory line. Below: small text links to hours of availability, coach profile, Twilio number, Stripe account.

### 6. Parent/Kid directory (secondary)

A clean list grouped by family. Search. Tap into a parent to see their history, all their kids, all past messages and sessions. This is the "rolodex" the coach replaces their notebook with. Not the main screen — don't overbuild.

## Interaction principles

- **Tap targets ≥ 44px on mobile.** This coach is in a hurry.
- **Pull-to-refresh** on home — real physical feel.
- **SSE-driven live updates** — when a new fire arrives while the coach is looking, the card slides in from the top with a soft amber pulse. Never a popup. Never a sound. Calm.
- **Optimistic sends** — when the coach taps "Send" on an approval, the card animates away immediately, shows a subtle "sent" confirmation, and lets them undo for 3 seconds (like Gmail).
- **Empty states are a feature.** "Nothing needs you. 12 handled this morning." with a soft illustration or a small moss checkmark. Never "No data found."
- **One-handed thumb zone** — primary actions bottom half of screen on mobile. Navigation as a bottom tab bar: Home · Audit · Parents · Settings.
- **Keyboard shortcuts** on desktop — `J/K` to move through fires, `E` to send, `Esc` to dismiss. Show them in a tiny footer hint.

## Component library (shadcn-style, Tailwind v4)

Produce reusable components:
- `TierBadge` (moss/amber/terracotta/stone variants)
- `IntentBadge` (BOOK / RESCHEDULE / QUESTION_LOGISTICS / PAYMENT / COMPLAINT / AMBIGUOUS / OUT_OF_SCOPE)
- `DecisionTrace` (collapsible, shows classify → policy → confidence → draft → validate)
- `ThreadBubble` (parent / agent-draft / agent-sent / coach variants)
- `ApprovalCard`, `FireCard`, `AutoHandledRow`, `SessionCard`
- `KidAvatar` (initials, warm tonal backgrounds derived from name hash)
- `PullToRefresh`, `BottomTabBar`, `TopGreeting`

## What success looks like

A technical judge (VP at Siemens) opens the app and feels: *this was built for a specific person, not for a template market.* A coach opens the app at 6am and feels: *my agent has this under control — I can coach today.*

## What to avoid

- Generic dashboard tiles with metric numbers and sparklines (we don't need "message volume" charts — we're not pitching analytics)
- Chat UI that looks like iMessage or Intercom
- Bright colors, gradients, glassmorphism blobs, dark-mode-by-default-with-neon, Web3 anything
- Sidebars with 12 nav items
- Modals. Use inline expansion or full-screen transitions instead.
- The word "Dashboard" anywhere in the UI copy. This is a **cockpit**, or just "Home."

## Deliverables

1. Mobile-first home/triage screen (both light and dark)
2. Approval detail / thread screen (mobile)
3. Audit log screen (desktop — this is where architecture shows)
4. Session detail screen (mobile)
5. Settings / kill switch (mobile)
6. Component sheet with tier badges, intent badges, cards, avatars, thread bubbles
7. Empty states for each screen
8. Design tokens file (colors, type scale, spacing, radii, shadows) ready to export to Tailwind config
