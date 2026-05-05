/**
 * Demo seed for elite track & field coach video walkthrough.
 * Wipes all demo data and re-seeds with realistic, Olympic-context fixtures.
 *
 * Run from backend/:
 *   COACH_ID=<id> npx tsx scripts/seed-demo.ts
 *
 * ─── DEMO FAMILIES ──────────────────────────────────────────────────
 *   Serena Mbeki      (+15550000101) → Zara,  15, sprinter (100m/200m)
 *   James Kowalski    (+15550000102) → Tyler, 16, javelin
 *   Mei-Ling Zhao     (+15550000103) → Lily,  13, long jump
 *   Rafael Torres     (+15550000104) → Marco, 17, high jump
 *   Diane Mitchell    (+15550000105) → Chloe, 14, 400m hurdles
 *
 * ─── TODAY'S SESSIONS (seeded) ──────────────────────────────────────
 *   2:00 PM  Tyler   — CONFIRMED, PAID (Venmo) — $120
 *   4:00 PM  Zara    — CONFIRMED, unpaid        — $120 ← payment demo target
 *   5:30 PM  Chloe   — CONFIRMED, unpaid        — $100
 *   (Ayla is added live via voice during the demo)
 *
 * ─── VOICE SCRIPT SAMPLES ───────────────────────────────────────────
 *   Session summary (Zara, post-session):
 *     "Great session with Zara today. Her block start reaction time is
 *     down to 0.142 seconds — she's in qualifier range. Drive phase is
 *     locked in, full extension at 20 meters with no shoulder drop.
 *     Left hamstring responded well — clear her for full intensity next
 *     session. Continue resistance band work three times this week,
 *     focusing on glute activation. Next priority: flying 60s to sharpen
 *     top-end speed before the regional qualifier."
 *
 *   Additional note after WhatsApp booking (Tyler):
 *     "Tyler booked for Thursday at 4pm. After today's breakthrough
 *     session his release angle is dialed in — consistently hitting 55
 *     to 58 meters. Big goal before the state championships: break 60
 *     meters. Make sure he gets full rest Wednesday, no throwing."
 *
 * ─── WHATSAPP DEMO MESSAGES ─────────────────────────────────────────
 *   Parent to coach (booking via WhatsApp):
 *     "Hey Coach, any slots this week for Tyler? He crushed his PB at
 *     the invitational — 57.3 meters. Want to keep the momentum going."
 *
 *   Parent to coach (note/recap request via WhatsApp):
 *     "Can you send me a quick summary of what you worked on with Zara
 *     today? I want to share it with her school track coach."
 */

import 'dotenv/config';
import {
  PrismaClient,
  Intent,
  ConfidenceTier,
  ApprovalStatus,
  Channel,
  SessionStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as never);

const COACH_ID = process.env.COACH_ID!;
if (!COACH_ID) throw new Error('COACH_ID env var is required');

const DEMO_PHONES = [
  '+15550000101', // Serena Mbeki  → Zara
  '+15550000102', // James Kowalski → Tyler
  '+15550000103', // Mei-Ling Zhao  → Lily
  '+15550000104', // Rafael Torres  → Marco
  '+15550000105', // Diane Mitchell → Chloe
];

// ─── Time helpers ───────────────────────────────────────────────────────────
function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000);
}
function minsAgo(m: number) {
  return new Date(Date.now() - m * 60_000);
}
function todayAt(hour: number, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}
function daysFromNow(days: number, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// ─── Wipe ───────────────────────────────────────────────────────────────────
async function wipe() {
  const demoParents = await prisma.parent.findMany({
    where: { coachId: COACH_ID, phone: { in: DEMO_PHONES } },
    select: { id: true },
  });
  const parentIds = demoParents.map((p) => p.id);

  const demoKids = await prisma.kid.findMany({
    where: { parentId: { in: parentIds } },
    select: { id: true },
  });
  const kidIds = demoKids.map((k) => k.id);

  const demoSessions = await prisma.session.findMany({
    where: { kidId: { in: kidIds } },
    select: { id: true },
  });
  const sessionIds = demoSessions.map((s) => s.id);

  if (sessionIds.length > 0) {
    await prisma.payment.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.approvalQueue.deleteMany({
      where: { sessionId: { in: sessionIds } },
    });
  }
  if (parentIds.length > 0) {
    await prisma.approvalQueue.deleteMany({
      where: { coachId: COACH_ID, message: { parentId: { in: parentIds } } },
    });
    await prisma.agentDecision.deleteMany({
      where: { coachId: COACH_ID, message: { parentId: { in: parentIds } } },
    });
    await prisma.message.deleteMany({
      where: { coachId: COACH_ID, parentId: { in: parentIds } },
    });
  }
  if (kidIds.length > 0) {
    await prisma.session.deleteMany({ where: { kidId: { in: kidIds } } });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
  }
  if (parentIds.length > 0) {
    await prisma.parent.deleteMany({ where: { id: { in: parentIds } } });
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('Wiping previous demo data…');
  await wipe();
  console.log('Seeding demo data for COACH_ID:', COACH_ID);

  // ── Parents & Kids ─────────────────────────────────────────────────────────
  const families = [
    {
      name: 'Serena Mbeki',
      phone: '+15550000101',
      kids: [
        {
          name: 'Zara',
          age: 15,
          rateCentsOverride: 12000,
          notes:
            'Elite 100m/200m sprinter. Regional champion last season. Left hamstring — monitor closely, flagged tightness two sessions ago. Targeting sub-11.8 at national qualifier in July. Very coachable, responds well to positive reinforcement and data feedback.',
        },
      ],
    },
    {
      name: 'James Kowalski',
      phone: '+15550000102',
      kids: [
        {
          name: 'Tyler',
          age: 16,
          rateCentsOverride: 12000,
          notes:
            'Javelin thrower. PR 57.3m set this week — breakthrough. Strong kinesthetic learner, video feedback highly effective. Qualifying for state championships. No injury history — full intensity cleared. Goal: break 60m before state meet.',
        },
      ],
    },
    {
      name: 'Mei-Ling Zhao',
      phone: '+15550000103',
      kids: [
        {
          name: 'Lily',
          age: 13,
          rateCentsOverride: 10000,
          notes:
            'Long jumper with exceptional approach speed. Penultimate step loading is the key unlock — inconsistent takeoff angle. Very driven, puts in home practice. Watch for overtraining signs. Next goal: 5.80m at junior regional.',
        },
      ],
    },
    {
      name: 'Rafael Torres',
      phone: '+15550000104',
      kids: [
        {
          name: 'Marco',
          age: 17,
          rateCentsOverride: 12000,
          notes:
            'High jumper. PR 2.08m — phenomenal for age. Fosbury Flop technically solid; focus is bar clearance and arch. Father is very involved in training decisions — keep him informed on technical rationale for any changes.',
        },
      ],
    },
    {
      name: 'Diane Mitchell',
      phone: '+15550000105',
      kids: [
        {
          name: 'Chloe',
          age: 14,
          rateCentsOverride: 10000,
          notes:
            '400m hurdles. 13-stride approach is clean for hurdles 1-3, loses rhythm at hurdles 4-6. Very competitive, tends to rush. Target: sub-61 seconds at regional in 6 weeks. Slight ankle sprain 10 days ago — fully cleared.',
        },
      ],
    },
  ];

  type ParentRecord = { parent: { id: string }; kids: { id: string; name: string }[] };
  const created: Record<string, ParentRecord> = {};

  for (const f of families) {
    const parent = await prisma.parent.create({
      data: {
        coachId: COACH_ID,
        name: f.name,
        phone: f.phone,
        isVerified: true,
        preferredChannel: 'WEB_CHAT',
      },
    });
    const kids: { id: string; name: string }[] = [];
    for (const k of f.kids) {
      const kid = await prisma.kid.create({
        data: {
          coachId: COACH_ID,
          parentId: parent.id,
          name: k.name,
          age: k.age,
          notes: k.notes,
          rateCentsOverride: k.rateCentsOverride,
        },
      });
      kids.push(kid);
    }
    created[f.name] = { parent, kids };
  }

  const p = (name: string) => created[name].parent;
  const kid = (parentName: string, idx = 0) => created[parentName].kids[idx];

  // ── Decision/message factory ───────────────────────────────────────────────
  let msgCounter = 3000;

  async function makeDecision(opts: {
    parent: { id: string };
    content: string;
    intent: Intent;
    confidence: number;
    tier: ConfidenceTier;
    actionTaken: string;
    reasoning: string;
    createdAt: Date;
    draftReply?: string;
    approvalStatus?: ApprovalStatus;
  }) {
    const msgId = `demo-msg-${msgCounter++}`;
    const msg = await prisma.message.create({
      data: {
        coachId: COACH_ID,
        parentId: opts.parent.id,
        direction: 'INBOUND',
        channel: Channel.SMS,
        providerMessageId: msgId,
        content: opts.content,
        receivedAt: opts.createdAt,
        processedAt: opts.createdAt,
      },
    });

    await prisma.agentDecision.create({
      data: {
        coachId: COACH_ID,
        messageId: msg.id,
        intent: opts.intent,
        confidence: opts.confidence,
        tier: opts.tier,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        actionTaken: opts.actionTaken as any,
        reasoning: opts.reasoning,
        llmModel: 'claude-haiku-4-5',
        tokensIn: Math.floor(Math.random() * 400) + 200,
        tokensOut: Math.floor(Math.random() * 150) + 50,
        latencyMs: Math.floor(Math.random() * 900) + 300,
        createdAt: opts.createdAt,
      },
    });

    if (opts.draftReply) {
      await prisma.approvalQueue.create({
        data: {
          coachId: COACH_ID,
          messageId: msg.id,
          draftReply: opts.draftReply,
          status: opts.approvalStatus ?? ApprovalStatus.PENDING,
          createdAt: opts.createdAt,
        },
      });
    }
  }

  // ── FIRES — escalated, needs immediate coach attention ────────────────────
  await makeDecision({
    parent: p('Serena Mbeki'),
    content:
      "Coach, I'm worried — Zara's been feeling tightness in her left hamstring since yesterday's session. Should we cancel this week's training? The national qualifier is only 7 weeks away and I really don't want to risk a serious injury.",
    intent: Intent.QUESTION_LOGISTICS,
    confidence: 0.46,
    tier: ConfidenceTier.ESCALATE,
    actionTaken: 'ESCALATED',
    reasoning:
      'Athlete injury concern flagged by parent. Involves medical judgment and load-management decisions — requires coach evaluation of current hamstring status. Cannot auto-respond without knowing severity.',
    createdAt: hoursAgo(1),
  });

  await makeDecision({
    parent: p('Rafael Torres'),
    content:
      "Hi Coach, I've been watching Marco's technique videos and comparing them to World Championship footage. I believe his Fosbury Flop arch needs significant adjustment — his back isn't parallel to the bar. I'd like to discuss changing his approach before the state meet.",
    intent: Intent.COMPLAINT,
    confidence: 0.39,
    tier: ConfidenceTier.ESCALATE,
    actionTaken: 'ESCALATED',
    reasoning:
      'Parent attempting to direct coaching technique changes. Sensitive — requires coach to respond personally to maintain professional authority while keeping a highly-involved parent engaged constructively.',
    createdAt: hoursAgo(4),
  });

  await makeDecision({
    parent: p('Diane Mitchell'),
    content:
      "Hey, I noticed we were charged $120 for the last session but our agreement was $100 per session. Can you clarify? I still have the original message where you quoted the $100 rate.",
    intent: Intent.PAYMENT,
    confidence: 0.53,
    tier: ConfidenceTier.ESCALATE,
    actionTaken: 'ESCALATED',
    reasoning:
      'Billing dispute with specific dollar amounts cited by parent. Requires coach to review original rate agreement and respond personally — risk of churn if not handled with care.',
    createdAt: hoursAgo(10),
  });

  // ── PENDING APPROVALS — AI drafted, awaiting coach send ──────────────────
  await makeDecision({
    parent: p('James Kowalski'),
    content:
      "Coach, can we move Tuesday's session to Thursday? Tyler has a qualifying invitational on Tuesday that just got confirmed this morning. Really sorry for the short notice.",
    intent: Intent.RESCHEDULE,
    confidence: 0.94,
    tier: ConfidenceTier.APPROVE,
    actionTaken: 'QUEUED_FOR_APPROVAL',
    reasoning:
      'Clear reschedule request from verified parent. Thursday slot is open in availability. Draft accurately reflects the change and maintains a positive, supportive tone. High confidence — ready for coach review.',
    draftReply:
      "Hi James! No problem at all — good luck to Tyler at the invitational! I've moved his session from Tuesday to Thursday at the same time. See you then, and can't wait to hear how the meet goes! 🏆",
    approvalStatus: ApprovalStatus.PENDING,
    createdAt: minsAgo(20),
  });

  await makeDecision({
    parent: p('Mei-Ling Zhao'),
    content:
      "Hi Coach! Lily has been putting in extra practice at home — she's so motivated right now. What takeoff drills would you recommend she work on between sessions to improve her consistency?",
    intent: Intent.QUESTION_PROGRESS,
    confidence: 0.79,
    tier: ConfidenceTier.APPROVE,
    actionTaken: 'QUEUED_FOR_APPROVAL',
    reasoning:
      'Progress question from verified, engaged parent. Confidence slightly below AUTO threshold — specific drill recommendations should reference session context. Queued for coach to verify and personalize.',
    draftReply:
      "Hi Mei-Ling! Love the energy — Lily's dedication is really showing in her approach speed. Have her focus on penultimate step loading: 3 sets of 10 bounding strides with an exaggerated penultimate dip. Single-leg box jumps for explosive takeoff power too. See you Thursday! 💪",
    approvalStatus: ApprovalStatus.PENDING,
    createdAt: minsAgo(48),
  });

  // ── AUTO-SENT — handled autonomously in last 24h ─────────────────────────
  const autoSent: Array<{
    parent: string;
    content: string;
    intent: Intent;
    reasoning: string;
    hoursBack: number;
  }> = [
    {
      parent: 'Diane Mitchell',
      content: "Just confirming Chloe is still on for today at 5:30?",
      intent: Intent.QUESTION_LOGISTICS,
      reasoning:
        'Session confirmation request from known parent. Session is scheduled and confirmed — auto-replied with confirmation and encouragement.',
      hoursBack: 1,
    },
    {
      parent: 'James Kowalski',
      content: "Tyler PR'd today — 57.3 meters at practice! He's pumped. Just had to share 🙌",
      intent: Intent.SMALLTALK,
      reasoning:
        'Positive performance update / smalltalk from verified parent. Auto-replied with warm congratulations aligned to the session goal.',
      hoursBack: 3,
    },
    {
      parent: 'Serena Mbeki',
      content:
        "What should Zara eat the morning before a training session? She's been feeling sluggish in the first 20 minutes.",
      intent: Intent.QUESTION_PROGRESS,
      reasoning:
        'General sports nutrition question from verified parent. Standard pre-session guidance given — no session-specific risk. Auto-replied.',
      hoursBack: 7,
    },
    {
      parent: 'Mei-Ling Zhao',
      content: "Do you accept Zelle for payment? That's the easiest for us.",
      intent: Intent.PAYMENT,
      reasoning:
        'Payment method inquiry. Coach accepts Zelle — standard info, auto-replied with confirmation.',
      hoursBack: 11,
    },
    {
      parent: 'Rafael Torres',
      content: "Is there parking at the training facility this weekend?",
      intent: Intent.QUESTION_LOGISTICS,
      reasoning:
        'Logistics question about parking — standard info, auto-replied with facility parking details.',
      hoursBack: 16,
    },
    {
      parent: 'James Kowalski',
      content:
        "Can you send me a quick summary of what you've been working on with Tyler? I want to share it with his high school PE teacher.",
      intent: Intent.QUESTION_PROGRESS,
      reasoning:
        'Progress summary request from verified parent. Overview of current training focus auto-replied based on session notes context.',
      hoursBack: 22,
    },
  ];

  for (const item of autoSent) {
    await makeDecision({
      parent: p(item.parent),
      content: item.content,
      intent: item.intent,
      confidence: 0.87 + Math.random() * 0.12,
      tier: ConfidenceTier.AUTO,
      actionTaken: 'AUTO_SENT',
      reasoning: item.reasoning,
      createdAt: hoursAgo(item.hoursBack),
    });
  }

  // ── OLDER HISTORY — for audit log walkthrough ─────────────────────────────
  const older: Array<{
    parent: string;
    content: string;
    intent: Intent;
    actionTaken: string;
    hoursBack: number;
  }> = [
    {
      parent: 'Serena Mbeki',
      content: "Zara won regionals! First place in the 100m, 11.92 seconds. She's absolutely over the moon.",
      intent: Intent.SMALLTALK,
      actionTaken: 'AUTO_SENT',
      hoursBack: 28,
    },
    {
      parent: 'Mei-Ling Zhao',
      content: "We need to cancel next Tuesday — Lily has a school field trip she can't miss.",
      intent: Intent.CANCEL,
      actionTaken: 'QUEUED_FOR_APPROVAL',
      hoursBack: 35,
    },
    {
      parent: 'Rafael Torres',
      content: "Marco jumped 2.08 meters at the invitational!! A massive personal best — he's on cloud nine.",
      intent: Intent.SMALLTALK,
      actionTaken: 'AUTO_SENT',
      hoursBack: 44,
    },
    {
      parent: 'Diane Mitchell',
      content:
        "Chloe twisted her ankle slightly at school — she'll be fine but can we reduce hurdle height this week?",
      intent: Intent.QUESTION_LOGISTICS,
      actionTaken: 'ESCALATED',
      hoursBack: 52,
    },
    {
      parent: 'James Kowalski',
      content:
        "Can we add an extra session this week? Tyler wants to put in more reps before the state qualifier.",
      intent: Intent.BOOK,
      actionTaken: 'QUEUED_FOR_APPROVAL',
      hoursBack: 62,
    },
    {
      parent: 'Serena Mbeki',
      content:
        "Can we add strength training to Zara's program? She wants to hit the gym three times a week alongside track.",
      intent: Intent.QUESTION_PROGRESS,
      actionTaken: 'ESCALATED',
      hoursBack: 74,
    },
  ];

  for (const item of older) {
    const tier =
      item.actionTaken === 'AUTO_SENT'
        ? ConfidenceTier.AUTO
        : item.actionTaken === 'QUEUED_FOR_APPROVAL'
          ? ConfidenceTier.APPROVE
          : ConfidenceTier.ESCALATE;
    await makeDecision({
      parent: p(item.parent),
      content: item.content,
      intent: item.intent,
      confidence: 0.70 + Math.random() * 0.25,
      tier,
      actionTaken: item.actionTaken,
      reasoning: 'Historical decision.',
      createdAt: hoursAgo(item.hoursBack),
    });
  }

  // ── TODAY'S SESSIONS ───────────────────────────────────────────────────────
  // Tyler 2:00 PM — completed earlier today, already paid via Venmo
  await prisma.session.create({
    data: {
      coachId: COACH_ID,
      kidId: kid('James Kowalski').id,
      scheduledAt: todayAt(14, 0),
      durationMinutes: 60,
      status: SessionStatus.CONFIRMED,
      paid: true,
      paymentMethod: 'VENMO',
      paidAt: hoursAgo(2),
      priceCents: 12000,
      coachNotes:
        'Exceptional release mechanics today — consistent 55-57m throws. First time breaking 55m in training. Full hip rotation on approach is clicking. Next session: competition-tempo approach run from full runway. Goal: 60m before state championships.',
    },
  });

  // Zara 4:00 PM — upcoming, not yet paid (payment demo target)
  await prisma.session.create({
    data: {
      coachId: COACH_ID,
      kidId: kid('Serena Mbeki').id,
      scheduledAt: todayAt(16, 0),
      durationMinutes: 75,
      status: SessionStatus.CONFIRMED,
      paid: false,
      priceCents: 12000,
      coachNotes:
        'Drive phase mechanics + block start drills. Left hamstring — light activation only, no max-effort sprints today. Target: sub-11.9 on flying 60m. Monitor stride frequency from meters 40-60.',
    },
  });

  // Chloe 5:30 PM — upcoming, not yet paid
  await prisma.session.create({
    data: {
      coachId: COACH_ID,
      kidId: kid('Diane Mitchell').id,
      scheduledAt: todayAt(17, 30),
      durationMinutes: 60,
      status: SessionStatus.CONFIRMED,
      paid: false,
      priceCents: 10000,
      coachNotes:
        'Hurdle clearance rhythm — 13-stride approach. Focus: hurdles 4-6 where she loses rhythm. Key drill: rhythm gate runs at 80% pace. Goal: clean 300H under 45 seconds by regional.',
    },
  });

  // ── UPCOMING SESSIONS (next week, visible on calendar) ────────────────────
  await prisma.session.create({
    data: {
      coachId: COACH_ID,
      kidId: kid('Mei-Ling Zhao').id,
      scheduledAt: daysFromNow(1, 15, 0),
      durationMinutes: 60,
      status: SessionStatus.CONFIRMED,
      paid: false,
      priceCents: 10000,
      coachNotes:
        'Penultimate step loading drills. Approach run consistency. Review takeoff angle on video replay — bring iPad.',
    },
  });

  await prisma.session.create({
    data: {
      coachId: COACH_ID,
      kidId: kid('Rafael Torres').id,
      scheduledAt: daysFromNow(2, 16, 0),
      durationMinutes: 60,
      status: SessionStatus.CONFIRMED,
      paid: false,
      priceCents: 12000,
      coachNotes:
        "Bar clearance and arch work. Approach run rhythm consistency. Keep father fully briefed on technical rationale — don't change anything without explaining the why.",
    },
  });

  await prisma.session.create({
    data: {
      coachId: COACH_ID,
      kidId: kid('James Kowalski').id,
      scheduledAt: daysFromNow(3, 14, 0),
      durationMinutes: 60,
      status: SessionStatus.CONFIRMED,
      paid: false,
      priceCents: 12000,
      coachNotes:
        'Competition-tempo approach from full runway. Targeting 58m+ throws. Film each attempt — send highlight clip to James after.',
    },
  });

  // ── AVAILABILITY SLOTS (next 5 days, for voice demo) ─────────────────────
  // Coach can demonstrate removing/adding these via voice during the demo
  const availSlots = [
    { daysAhead: 1, hour: 9 },   // Tomorrow 9am
    { daysAhead: 1, hour: 11 },  // Tomorrow 11am
    { daysAhead: 2, hour: 9 },   // Day after 9am
    { daysAhead: 2, hour: 13 },  // Day after 1pm
    { daysAhead: 3, hour: 9 },   // 3 days out 9am
    { daysAhead: 4, hour: 10 },  // 4 days out 10am
    { daysAhead: 5, hour: 9 },   // 5 days out 9am
    { daysAhead: 5, hour: 14 },  // 5 days out 2pm
  ];

  for (const slot of availSlots) {
    const startAt = daysFromNow(slot.daysAhead, slot.hour, 0);
    const endAt = new Date(startAt);
    endAt.setHours(slot.hour + 1, 0, 0, 0);
    await prisma.availability.create({
      data: { coachId: COACH_ID, startAt, endAt, isBlocked: false, reason: '' },
    });
  }

  console.log('\n✅ Demo seed complete!');
  console.log('   Parents:              5  (Serena, James, Mei-Ling, Rafael, Diane)');
  console.log('   Fires (escalated):    3  (hamstring concern, parent coaching advice, billing dispute)');
  console.log('   Pending approvals:    2  (reschedule Tyler, drill advice for Lily)');
  console.log('   Auto-handled 24h:     6  (confirmation, smalltalk, nutrition, payment Q, parking, summary)');
  console.log('   Audit history:        6  (older decisions for log walkthrough)');
  console.log('   Sessions today:       3  (Tyler 2pm PAID, Zara 4pm $120, Chloe 5:30pm $100)');
  console.log('   Upcoming sessions:    3  (Lily +1d, Marco +2d, Tyler +3d)');
  console.log('   Availability slots:   8  (next 5 days — demo add/remove via voice)');
  console.log('\n─── VOICE SCRIPTS ────────────────────────────────────────────────────────');
  console.log('\n  Session summary for Zara (post-session voice note):');
  console.log('  "Great session with Zara today. Her block start reaction time is down to');
  console.log('  0.142 seconds — she\'s in qualifier range. Drive phase is locked in, full');
  console.log('  extension at 20 meters with no shoulder drop. Left hamstring responded');
  console.log('  well — clear her for full intensity next session. Continue resistance band');
  console.log('  work three times this week, focusing on glute activation and hip bridges.');
  console.log('  Next priority: flying 60-meter runs to sharpen top-end speed before the');
  console.log('  regional qualifier."');
  console.log('\n  Additional note after Tyler booking via WhatsApp:');
  console.log('  "Tyler booked for Thursday at 4pm. After today\'s breakthrough session his');
  console.log('  release angle is completely dialed — hitting 55 to 58 meters consistently.');
  console.log('  Big goal before state championships: break 60 meters. Make sure he gets');
  console.log('  full rest Wednesday, absolutely no throwing."');
  console.log('\n─── WHATSAPP SAMPLE MESSAGES ─────────────────────────────────────────────');
  console.log('\n  Parent booking via WhatsApp (send as James Kowalski):');
  console.log('  "Hey Coach, any open slots this week for Tyler? He crushed his personal');
  console.log('  best at the invitational — 57.3 meters. Want to keep that momentum going."');
  console.log('\n  Parent note/recap request via WhatsApp:');
  console.log('  "Can you send me a quick summary of what you worked on with Zara today?');
  console.log('  I want to share it with her school track coach."');
  console.log('');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
