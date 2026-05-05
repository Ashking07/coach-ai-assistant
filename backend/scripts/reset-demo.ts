/**
 * Full demo reset — clears ghost sessions + all demo data, then re-seeds clean.
 *
 * "Ghost sessions" = any PROPOSED/CONFIRMED unpaid session for this coach that
 * is NOT from the current demo seed families. Includes test sessions added via
 * voice or manual dashboard during previous demo runs (e.g. Ayla test sessions).
 *
 * Safe: never deletes PAID or COMPLETED sessions (real records).
 *
 * Run from backend/:
 *   COACH_ID=<id> npx tsx scripts/reset-demo.ts
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
  '+15550000101',
  '+15550000102',
  '+15550000103',
  '+15550000104',
  '+15550000105',
];

function hoursAgo(h: number) { return new Date(Date.now() - h * 3_600_000); }
function minsAgo(m: number)  { return new Date(Date.now() - m * 60_000); }
function todayAt(hour: number, minute = 0) {
  const d = new Date(); d.setHours(hour, minute, 0, 0); return d;
}
function daysFromNow(days: number, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// ─── Wipe ───────────────────────────────────────────────────────────────────
async function wipe() {
  // 1. Wipe demo families
  const demoParents = await prisma.parent.findMany({
    where: { coachId: COACH_ID, phone: { in: DEMO_PHONES } },
    select: { id: true },
  });
  const demoParentIds = demoParents.map((p) => p.id);

  const demoKids = await prisma.kid.findMany({
    where: { parentId: { in: demoParentIds } },
    select: { id: true },
  });
  const demoKidIds = demoKids.map((k) => k.id);

  const demoSessions = await prisma.session.findMany({
    where: { kidId: { in: demoKidIds } },
    select: { id: true },
  });
  const demoSessionIds = demoSessions.map((s) => s.id);

  if (demoSessionIds.length > 0) {
    await prisma.payment.deleteMany({ where: { sessionId: { in: demoSessionIds } } });
    await prisma.approvalQueue.deleteMany({ where: { sessionId: { in: demoSessionIds } } });
  }
  if (demoParentIds.length > 0) {
    await prisma.approvalQueue.deleteMany({
      where: { coachId: COACH_ID, message: { parentId: { in: demoParentIds } } },
    });
    await prisma.agentDecision.deleteMany({
      where: { coachId: COACH_ID, message: { parentId: { in: demoParentIds } } },
    });
    await prisma.message.deleteMany({ where: { coachId: COACH_ID, parentId: { in: demoParentIds } } });
  }
  if (demoKidIds.length > 0) {
    await prisma.session.deleteMany({ where: { kidId: { in: demoKidIds } } });
    await prisma.kid.deleteMany({ where: { id: { in: demoKidIds } } });
  }
  if (demoParentIds.length > 0) {
    await prisma.parent.deleteMany({ where: { id: { in: demoParentIds } } });
  }

  // 2. Wipe ghost sessions — PROPOSED/CONFIRMED unpaid sessions for real (non-demo) kids
  //    These are leftover test sessions from voice/manual demo runs.
  //    Safe: skips PAID and COMPLETED sessions.
  const ghostResult = await prisma.session.deleteMany({
    where: {
      coachId: COACH_ID,
      paid: false,
      status: { in: [SessionStatus.PROPOSED, SessionStatus.CONFIRMED] },
      kid: { parent: { phone: { notIn: DEMO_PHONES } } },
    },
  });
  console.log(`  Ghost sessions deleted: ${ghostResult.count}`);

  // 3. Wipe ALL availability for this coach (seed will recreate demo slots)
  const availResult = await prisma.availability.deleteMany({ where: { coachId: COACH_ID } });
  console.log(`  Availability slots cleared: ${availResult.count}`);
}

// ─── Seed (same as seed-demo.ts) ────────────────────────────────────────────
async function seed() {
  const families = [
    {
      name: 'Serena Mbeki', phone: '+15550000101',
      kids: [{ name: 'Zara', age: 15, rateCentsOverride: 12000,
        notes: 'Elite 100m/200m sprinter. Regional champion last season. Left hamstring — monitor closely. Targeting sub-11.8 at national qualifier in July. Responds well to positive reinforcement and data feedback.' }],
    },
    {
      name: 'James Kowalski', phone: '+15550000102',
      kids: [{ name: 'Tyler', age: 16, rateCentsOverride: 12000,
        notes: 'Javelin thrower. PR 57.3m — breakthrough this week. Strong kinesthetic learner, video feedback effective. Qualifying for state championships. No injury history. Goal: break 60m before state meet.' }],
    },
    {
      name: 'Mei-Ling Zhao', phone: '+15550000103',
      kids: [{ name: 'Lily', age: 13, rateCentsOverride: 10000,
        notes: 'Long jumper with exceptional approach speed. Penultimate step loading is the key unlock. Very driven, puts in home practice. Watch for overtraining signs. Next goal: 5.80m at junior regional.' }],
    },
    {
      name: 'Rafael Torres', phone: '+15550000104',
      kids: [{ name: 'Marco', age: 17, rateCentsOverride: 12000,
        notes: 'High jumper. PR 2.08m. Fosbury Flop technically solid; focus on bar clearance and arch. Father very involved — keep him informed on technical rationale for any changes.' }],
    },
    {
      name: 'Diane Mitchell', phone: '+15550000105',
      kids: [{ name: 'Chloe', age: 14, rateCentsOverride: 10000,
        notes: '400m hurdles. 13-stride approach clean for hurdles 1-3, loses rhythm at 4-6. Very competitive, tends to rush. Target: sub-61 seconds at regional in 6 weeks. Ankle fully cleared.' }],
    },
  ];

  type Rec = { parent: { id: string }; kids: { id: string; name: string }[] };
  const created: Record<string, Rec> = {};

  for (const f of families) {
    const parent = await prisma.parent.create({
      data: { coachId: COACH_ID, name: f.name, phone: f.phone, isVerified: true, preferredChannel: 'WEB_CHAT' },
    });
    const kids: { id: string; name: string }[] = [];
    for (const k of f.kids) {
      const kid = await prisma.kid.create({
        data: { coachId: COACH_ID, parentId: parent.id, name: k.name, age: k.age, notes: k.notes, rateCentsOverride: k.rateCentsOverride },
      });
      kids.push(kid);
    }
    created[f.name] = { parent, kids };
  }

  const p  = (n: string) => created[n].parent;
  const k  = (n: string) => created[n].kids[0];

  let counter = 3000;
  async function decision(opts: {
    parent: { id: string }; content: string; intent: Intent; confidence: number;
    tier: ConfidenceTier; actionTaken: string; reasoning: string; createdAt: Date;
    draftReply?: string; approvalStatus?: ApprovalStatus;
  }) {
    const msgId = `demo-msg-${counter++}`;
    const msg = await prisma.message.create({
      data: { coachId: COACH_ID, parentId: opts.parent.id, direction: 'INBOUND', channel: Channel.SMS,
        providerMessageId: msgId, content: opts.content, receivedAt: opts.createdAt, processedAt: opts.createdAt },
    });
    await prisma.agentDecision.create({
      data: { coachId: COACH_ID, messageId: msg.id, intent: opts.intent, confidence: opts.confidence,
        tier: opts.tier, actionTaken: opts.actionTaken as never, reasoning: opts.reasoning,
        llmModel: 'claude-haiku-4-5', tokensIn: Math.floor(Math.random()*400)+200,
        tokensOut: Math.floor(Math.random()*150)+50, latencyMs: Math.floor(Math.random()*900)+300, createdAt: opts.createdAt },
    });
    if (opts.draftReply) {
      await prisma.approvalQueue.create({
        data: { coachId: COACH_ID, messageId: msg.id, draftReply: opts.draftReply,
          status: opts.approvalStatus ?? ApprovalStatus.PENDING, createdAt: opts.createdAt },
      });
    }
  }

  // FIRES
  await decision({ parent: p('Serena Mbeki'), intent: Intent.QUESTION_LOGISTICS, confidence: 0.46, tier: ConfidenceTier.ESCALATE, actionTaken: 'ESCALATED', createdAt: hoursAgo(1),
    content: "Coach, I'm worried — Zara's been feeling tightness in her left hamstring since yesterday's session. Should we cancel this week's training? The national qualifier is only 7 weeks away and I really don't want to risk a serious injury.",
    reasoning: 'Athlete injury concern — requires coach evaluation of hamstring status. Cannot auto-respond without knowing severity.' });

  await decision({ parent: p('Rafael Torres'), intent: Intent.COMPLAINT, confidence: 0.39, tier: ConfidenceTier.ESCALATE, actionTaken: 'ESCALATED', createdAt: hoursAgo(4),
    content: "Hi Coach, I've been watching Marco's technique videos and comparing them to World Championship footage. I believe his Fosbury Flop arch needs significant adjustment — his back isn't parallel to the bar. I'd like to discuss changing his approach before the state meet.",
    reasoning: 'Parent attempting to direct coaching technique. Requires coach to respond personally to maintain professional authority.' });

  await decision({ parent: p('Diane Mitchell'), intent: Intent.PAYMENT, confidence: 0.53, tier: ConfidenceTier.ESCALATE, actionTaken: 'ESCALATED', createdAt: hoursAgo(10),
    content: "Hey, I noticed we were charged $120 for the last session but our agreement was $100 per session. Can you clarify? I still have the original message where you quoted the $100 rate.",
    reasoning: 'Billing dispute with specific amounts cited. Requires coach to review original rate agreement personally.' });

  // PENDING APPROVALS
  await decision({ parent: p('James Kowalski'), intent: Intent.RESCHEDULE, confidence: 0.94, tier: ConfidenceTier.APPROVE, actionTaken: 'QUEUED_FOR_APPROVAL', createdAt: minsAgo(20),
    content: "Coach, can we move Tuesday's session to Thursday? Tyler has a qualifying invitational on Tuesday that just got confirmed. Really sorry for the short notice.",
    reasoning: 'Clear reschedule from verified parent. Thursday slot open. High confidence — ready for coach review.',
    draftReply: "Hi James! No problem at all — good luck to Tyler at the invitational! I've moved his session from Tuesday to Thursday at the same time. See you then, and can't wait to hear how the meet goes! 🏆",
    approvalStatus: ApprovalStatus.PENDING });

  await decision({ parent: p('Mei-Ling Zhao'), intent: Intent.QUESTION_PROGRESS, confidence: 0.79, tier: ConfidenceTier.APPROVE, actionTaken: 'QUEUED_FOR_APPROVAL', createdAt: minsAgo(48),
    content: "Hi Coach! Lily has been putting in extra practice at home — she's so motivated right now. What takeoff drills would you recommend she work on between sessions?",
    reasoning: 'Progress question from verified parent. Specific drill recommendations should reference session context. Queued for coach to personalize.',
    draftReply: "Hi Mei-Ling! Love the energy — Lily's dedication is showing in her approach speed. Have her focus on penultimate step loading: 3 sets of 10 bounding strides with an exaggerated penultimate dip. Single-leg box jumps for explosive takeoff too. See you Thursday! 💪",
    approvalStatus: ApprovalStatus.PENDING });

  // AUTO-SENT
  const auto = [
    { parent: 'Diane Mitchell',  hoursBack: 1,  intent: Intent.QUESTION_LOGISTICS, reasoning: 'Session confirmation from known parent — auto-replied.',                              content: "Just confirming Chloe is still on for today at 5:30?" },
    { parent: 'James Kowalski',  hoursBack: 3,  intent: Intent.SMALLTALK,           reasoning: 'Positive update — auto-replied with warm congratulations.',                         content: "Tyler PR'd today — 57.3 meters at practice! He's pumped 🙌" },
    { parent: 'Serena Mbeki',    hoursBack: 7,  intent: Intent.QUESTION_PROGRESS,   reasoning: 'General nutrition question — standard guidance auto-replied.',                     content: "What should Zara eat the morning before a training session? She's been feeling sluggish." },
    { parent: 'Mei-Ling Zhao',   hoursBack: 11, intent: Intent.PAYMENT,             reasoning: 'Payment method inquiry — coach accepts Zelle, auto-replied.',                      content: "Do you accept Zelle for payment? That's the easiest for us." },
    { parent: 'Rafael Torres',   hoursBack: 16, intent: Intent.QUESTION_LOGISTICS,  reasoning: 'Parking logistics — standard info auto-replied.',                                  content: "Is there parking at the training facility this weekend?" },
    { parent: 'James Kowalski',  hoursBack: 22, intent: Intent.QUESTION_PROGRESS,   reasoning: 'Progress summary request — overview auto-replied from session notes context.',     content: "Can you send me a quick summary of what you've been working on with Tyler? I want to share it with his PE teacher." },
  ];
  for (const item of auto) {
    await decision({ parent: p(item.parent), intent: item.intent, confidence: 0.87 + Math.random()*0.12,
      tier: ConfidenceTier.AUTO, actionTaken: 'AUTO_SENT', reasoning: item.reasoning, createdAt: hoursAgo(item.hoursBack), content: item.content });
  }

  // OLDER AUDIT
  const older = [
    { parent: 'Serena Mbeki',   hoursBack: 28, intent: Intent.SMALLTALK,          actionTaken: 'AUTO_SENT',           content: "Zara won regionals! First place in the 100m, 11.92 seconds. She's absolutely over the moon." },
    { parent: 'Mei-Ling Zhao',  hoursBack: 35, intent: Intent.CANCEL,             actionTaken: 'QUEUED_FOR_APPROVAL', content: "We need to cancel next Tuesday — Lily has a school field trip she can't miss." },
    { parent: 'Rafael Torres',  hoursBack: 44, intent: Intent.SMALLTALK,          actionTaken: 'AUTO_SENT',           content: "Marco jumped 2.08 meters at the invitational!! A massive personal best." },
    { parent: 'Diane Mitchell', hoursBack: 52, intent: Intent.QUESTION_LOGISTICS, actionTaken: 'ESCALATED',           content: "Chloe twisted her ankle slightly at school — can we reduce hurdle height this week?" },
    { parent: 'James Kowalski', hoursBack: 62, intent: Intent.BOOK,              actionTaken: 'QUEUED_FOR_APPROVAL', content: "Can we add an extra session this week? Tyler wants more reps before the state qualifier." },
    { parent: 'Serena Mbeki',   hoursBack: 74, intent: Intent.QUESTION_PROGRESS,  actionTaken: 'ESCALATED',           content: "Can we add strength training to Zara's program? She wants to hit the gym three times a week." },
  ];
  for (const item of older) {
    const tier = item.actionTaken === 'AUTO_SENT' ? ConfidenceTier.AUTO : item.actionTaken === 'QUEUED_FOR_APPROVAL' ? ConfidenceTier.APPROVE : ConfidenceTier.ESCALATE;
    await decision({ parent: p(item.parent), intent: item.intent, confidence: 0.70 + Math.random()*0.25,
      tier, actionTaken: item.actionTaken, reasoning: 'Historical decision.', createdAt: hoursAgo(item.hoursBack), content: item.content });
  }

  // TODAY'S SESSIONS
  await prisma.session.create({ data: { coachId: COACH_ID, kidId: k('James Kowalski').id, scheduledAt: todayAt(14,0),  durationMinutes: 60, status: SessionStatus.CONFIRMED, paid: true,  paymentMethod: 'VENMO', paidAt: hoursAgo(2), priceCents: 12000, coachNotes: 'Exceptional release mechanics — consistent 55-57m throws. First time breaking 55m in training. Full hip rotation clicking. Next: competition-tempo approach from full runway. Goal: 60m before state.' } });
  await prisma.session.create({ data: { coachId: COACH_ID, kidId: k('Serena Mbeki').id,   scheduledAt: todayAt(16,0),  durationMinutes: 75, status: SessionStatus.CONFIRMED, paid: false, priceCents: 12000, coachNotes: 'Drive phase mechanics + block start. Left hamstring — light activation only, no max-effort. Target: sub-11.9 on flying 60m. Monitor stride frequency at meters 40-60.' } });
  await prisma.session.create({ data: { coachId: COACH_ID, kidId: k('Diane Mitchell').id,  scheduledAt: todayAt(17,30), durationMinutes: 60, status: SessionStatus.CONFIRMED, paid: false, priceCents: 10000, coachNotes: 'Hurdle clearance rhythm — 13-stride approach. Focus: hurdles 4-6 where she loses rhythm. Key drill: rhythm gate runs. Goal: clean 300H under 45 seconds by regional.' } });

  // UPCOMING SESSIONS
  await prisma.session.create({ data: { coachId: COACH_ID, kidId: k('Mei-Ling Zhao').id,  scheduledAt: daysFromNow(1,15,0), durationMinutes: 60, status: SessionStatus.CONFIRMED, paid: false, priceCents: 10000, coachNotes: 'Penultimate step loading drills. Approach run consistency. Review takeoff angle on video — bring iPad.' } });
  await prisma.session.create({ data: { coachId: COACH_ID, kidId: k('Rafael Torres').id,  scheduledAt: daysFromNow(2,16,0), durationMinutes: 60, status: SessionStatus.CONFIRMED, paid: false, priceCents: 12000, coachNotes: "Bar clearance and arch work. Keep father briefed on technical rationale — don't change anything without explaining the why." } });
  await prisma.session.create({ data: { coachId: COACH_ID, kidId: k('James Kowalski').id, scheduledAt: daysFromNow(3,14,0), durationMinutes: 60, status: SessionStatus.CONFIRMED, paid: false, priceCents: 12000, coachNotes: 'Competition-tempo approach from full runway. Targeting 58m+ throws. Film each attempt.' } });

  // AVAILABILITY SLOTS
  for (const slot of [
    {d:1,h:9},{d:1,h:11},{d:2,h:9},{d:2,h:13},{d:3,h:9},{d:4,h:10},{d:5,h:9},{d:5,h:14},
  ]) {
    const startAt = daysFromNow(slot.d, slot.h, 0);
    const endAt   = new Date(startAt); endAt.setHours(slot.h + 1, 0, 0, 0);
    await prisma.availability.create({ data: { coachId: COACH_ID, startAt, endAt, isBlocked: false, reason: '' } });
  }
}

async function main() {
  console.log('\n🧹 Wiping ghost sessions + demo data…');
  await wipe();

  console.log('🌱 Re-seeding…');
  await seed();

  console.log('\n✅ Reset complete!');
  console.log('   Demo families: 5');
  console.log('   Fires: 3 · Approvals: 2 · Auto-handled: 6 · History: 6');
  console.log('   Sessions today: 3 (Tyler 2pm PAID, Zara 4pm $120, Chloe 5:30pm $100)');
  console.log('   Upcoming: 3 · Availability slots: 8');
  console.log('   (Ayla and other test sessions cleared)\n');
}

main()
  .catch(console.error)
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
