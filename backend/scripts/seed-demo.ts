/**
 * Wipes all demo data and re-seeds the dashboard with realistic test fixtures.
 * Run from backend/: npx tsx scripts/seed-demo.ts
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

const DEMO_PHONES = [
  '+15550000101',
  '+15550000102',
  '+15550000103',
  '+15550000104',
  '+15550000105',
];

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}
function minsAgo(m: number) {
  return new Date(Date.now() - m * 60 * 1000);
}
function todayAt(hour: number, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function wipe() {
  // Delete in dependency order
  await prisma.approvalQueue.deleteMany({ where: { coachId: COACH_ID, message: { parent: { phone: { in: DEMO_PHONES } } } } });
  await prisma.agentDecision.deleteMany({ where: { coachId: COACH_ID, message: { parent: { phone: { in: DEMO_PHONES } } } } });
  await prisma.message.deleteMany({ where: { coachId: COACH_ID, parent: { phone: { in: DEMO_PHONES } } } });
  await prisma.session.deleteMany({ where: { coachId: COACH_ID, kid: { parent: { phone: { in: DEMO_PHONES } } } } });
  await prisma.kid.deleteMany({ where: { coachId: COACH_ID, parent: { phone: { in: DEMO_PHONES } } } });
  await prisma.parent.deleteMany({ where: { coachId: COACH_ID, phone: { in: DEMO_PHONES } } });
}

async function main() {
  console.log('Wiping previous demo data…');
  await wipe();
  console.log('Seeding demo data for COACH_ID:', COACH_ID);

  // ── Parents & Kids ──────────────────────────────────────────────────────────
  const families = [
    { name: 'Amara Osei',      phone: '+15550000101', kids: [{ name: 'Kofi',  age: 9  }] },
    { name: 'Jessica Tanaka',  phone: '+15550000102', kids: [{ name: 'Rhea',  age: 11 }, { name: 'Sora', age: 8 }] },
    { name: 'Marcus Webb',     phone: '+15550000103', kids: [{ name: 'Eli',   age: 10 }] },
    { name: 'Priya Nair',      phone: '+15550000104', kids: [{ name: 'Aryan', age: 12 }] },
    { name: 'Claudette Moreau',phone: '+15550000105', kids: [{ name: 'Luc',   age: 7  }] },
  ];

  const createdParents: Record<string, { parent: { id: string }; kids: { id: string; name: string }[] }> = {};

  for (const f of families) {
    const parent = await prisma.parent.create({
      data: { coachId: COACH_ID, name: f.name, phone: f.phone, isVerified: true },
    });
    const kids = [];
    for (const k of f.kids) {
      const kid = await prisma.kid.create({
        data: { coachId: COACH_ID, parentId: parent.id, name: k.name, age: k.age },
      });
      kids.push(kid);
    }
    createdParents[f.name] = { parent, kids };
  }

  const p = (name: string) => createdParents[name].parent;
  const kid = (parentName: string, idx = 0) => createdParents[parentName].kids[idx];

  // ── Helper ──────────────────────────────────────────────────────────────────
  let msgCounter = 2000;
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

    const decision = await prisma.agentDecision.create({
      data: {
        coachId: COACH_ID,
        messageId: msg.id,
        intent: opts.intent,
        confidence: opts.confidence,
        tier: opts.tier,
        actionTaken: opts.actionTaken,
        reasoning: opts.reasoning,
        llmModel: 'claude-haiku-4-5',
        tokensIn:  Math.floor(Math.random() * 400) + 200,
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

    return { msg, decision };
  }

  // ── FIRES — escalated decisions in last 24h ─────────────────────────────────
  await makeDecision({
    parent: p('Amara Osei'),
    content: "Hi, I noticed two charges on my card this month — one on the 3rd and another on the 18th. Can you clarify what the second one is for?",
    intent: Intent.PAYMENT,
    confidence: 0.52,
    tier: ConfidenceTier.ESCALATE,
    actionTaken: 'ESCALATED',
    reasoning: 'Billing dispute requires coach review. Two charges mentioned — could be duplicate or legitimate (package upgrade). Cannot auto-respond without account details.',
    createdAt: hoursAgo(2),
  });

  await makeDecision({
    parent: p('Marcus Webb'),
    content: "Eli has been really struggling lately and honestly I'm questioning whether this is even worth continuing. We've spent a lot and I'm not seeing results.",
    intent: Intent.COMPLAINT,
    confidence: 0.44,
    tier: ConfidenceTier.ESCALATE,
    actionTaken: 'ESCALATED',
    reasoning: 'Parent expressing frustration and hinting at churn. Sensitive — requires personal coach response, not automated reply.',
    createdAt: hoursAgo(5),
  });

  await makeDecision({
    parent: p('Claudette Moreau'),
    content: "Actually can we just cancel everything? Luc has a new soccer schedule and I don't think we can make it work anymore.",
    intent: Intent.CANCEL,
    confidence: 0.61,
    tier: ConfidenceTier.ESCALATE,
    actionTaken: 'ESCALATED',
    reasoning: 'Cancellation request — policy requires coach to handle personally and explore alternatives before processing.',
    createdAt: hoursAgo(14),
  });

  // ── PENDING APPROVALS ───────────────────────────────────────────────────────
  await makeDecision({
    parent: p('Jessica Tanaka'),
    content: "Hey! Can we move Thursday's session to Friday same time? Rhea has a dentist appointment.",
    intent: Intent.RESCHEDULE,
    confidence: 0.91,
    tier: ConfidenceTier.APPROVE,
    actionTaken: 'QUEUED_FOR_APPROVAL',
    reasoning: 'Known parent, verified. Reschedule request for a specific session. Friday slot appears open in availability. Draft looks correct.',
    draftReply: "Hi Jessica! No problem at all — I've moved Rhea's session from Thursday to Friday at the same time. See you then! 🙌",
    approvalStatus: ApprovalStatus.PENDING,
    createdAt: minsAgo(18),
  });

  await makeDecision({
    parent: p('Priya Nair'),
    content: "Hi, Aryan mentioned you might have a morning slot opening up next week? He'd love to switch from afternoon if possible.",
    intent: Intent.RESCHEDULE,
    confidence: 0.78,
    tier: ConfidenceTier.APPROVE,
    actionTaken: 'QUEUED_FOR_APPROVAL',
    reasoning: 'Slot inquiry for schedule change. Confidence slightly below AUTO threshold — morning availability not confirmed in context. Queued for coach to verify slot.',
    draftReply: "Hi Priya! Let me check what I have opening up next week — I'll get back to you shortly with the available morning times for Aryan.",
    approvalStatus: ApprovalStatus.PENDING,
    createdAt: minsAgo(45),
  });

  // ── AUTO-SENT (last 24h) ────────────────────────────────────────────────────
  const autoSent = [
    { parent: 'Jessica Tanaka',  content: "What time does Rhea's session start tomorrow?",               intent: Intent.QUESTION_LOGISTICS, reasoning: "Known parent asking about confirmed session time. Answered with session details from calendar.", hoursBack: 1  },
    { parent: 'Amara Osei',      content: "Just confirming we're still on for Tuesday?",                 intent: Intent.QUESTION_LOGISTICS, reasoning: "Confirmation request for existing session. Session is confirmed in system — auto-replied.", hoursBack: 3  },
    { parent: 'Marcus Webb',     content: "Hey, quick question — what should Eli be practicing this week?", intent: Intent.QUESTION_PROGRESS, reasoning: "Progress question from verified parent. Answered with general guidance from session notes.", hoursBack: 6  },
    { parent: 'Priya Nair',      content: "Hi! Just wanted to say Aryan had a great week. He's been so motivated!", intent: Intent.SMALLTALK, reasoning: "Positive feedback / smalltalk. Auto-replied with warm acknowledgment.", hoursBack: 8  },
    { parent: 'Claudette Moreau',content: "Can you send me the invoice for last month?",                 intent: Intent.PAYMENT,            reasoning: "Invoice request — standard inquiry, auto-replied directing to Stripe portal.", hoursBack: 16 },
    { parent: 'Jessica Tanaka',  content: "Do you have a slot for Sora next month? She wants to start too!", intent: Intent.BOOK,            reasoning: "Booking inquiry for second child — high confidence, verified parent. Auto-replied with availability offer.", hoursBack: 20 },
  ];

  for (const item of autoSent) {
    await makeDecision({
      parent: p(item.parent),
      content: item.content,
      intent: item.intent,
      confidence: 0.88 + Math.random() * 0.11,
      tier: ConfidenceTier.AUTO,
      actionTaken: 'AUTO_SENT',
      reasoning: item.reasoning,
      createdAt: hoursAgo(item.hoursBack),
    });
  }

  // ── OLDER AUDIT HISTORY ─────────────────────────────────────────────────────
  const older = [
    { parent: 'Amara Osei',      content: "We need to reschedule next week's session — family trip.",  intent: Intent.RESCHEDULE,         actionTaken: 'AUTO_SENT',            hoursBack: 30 },
    { parent: 'Marcus Webb',     content: "Is there parking at your location?",                        intent: Intent.QUESTION_LOGISTICS, actionTaken: 'AUTO_SENT',            hoursBack: 36 },
    { parent: 'Priya Nair',      content: "Aryan won't make it Wednesday — fever.",                    intent: Intent.CANCEL,             actionTaken: 'QUEUED_FOR_APPROVAL',  hoursBack: 48 },
    { parent: 'Claudette Moreau',content: "Thank you for everything, Luc talks about sessions all week!", intent: Intent.SMALLTALK,        actionTaken: 'AUTO_SENT',            hoursBack: 52 },
    { parent: 'Jessica Tanaka',  content: "Can we add 15 min to Thursday's session?",                 intent: Intent.RESCHEDULE,         actionTaken: 'ESCALATED',            hoursBack: 60 },
  ];

  for (const item of older) {
    const tier = item.actionTaken === 'AUTO_SENT' ? ConfidenceTier.AUTO
               : item.actionTaken === 'QUEUED_FOR_APPROVAL' ? ConfidenceTier.APPROVE
               : ConfidenceTier.ESCALATE;
    await makeDecision({
      parent: p(item.parent),
      content: item.content,
      intent: item.intent,
      confidence: 0.75 + Math.random() * 0.2,
      tier,
      actionTaken: item.actionTaken,
      reasoning: 'Historical decision.',
      createdAt: hoursAgo(item.hoursBack),
    });
  }

  // ── TODAY'S SESSIONS ────────────────────────────────────────────────────────
  await prisma.session.create({
    data: { coachId: COACH_ID, kidId: kid('Jessica Tanaka').id, scheduledAt: todayAt(16, 0),  durationMinutes: 60, status: SessionStatus.CONFIRMED, paid: true,  coachNotes: 'Focus on visualization techniques and pre-game routine.' },
  });
  await prisma.session.create({
    data: { coachId: COACH_ID, kidId: kid('Priya Nair').id,     scheduledAt: todayAt(17, 30), durationMinutes: 45, status: SessionStatus.CONFIRMED, paid: false, coachNotes: 'Aryan wants to work on penalty kicks. Bring the resistance bands.' },
  });
  await prisma.session.create({
    data: { coachId: COACH_ID, kidId: kid('Amara Osei').id,     scheduledAt: todayAt(19, 0),  durationMinutes: 60, status: SessionStatus.PROPOSED,  paid: false, coachNotes: '' },
  });

  console.log('\n✓ Demo seed complete!');
  console.log('  Parents:', families.length);
  console.log('  Fires (escalated, last 24h): 3');
  console.log('  Pending approvals: 2');
  console.log('  Auto-handled (last 24h): 6');
  console.log('  Audit history (older): 5');
  console.log('  Sessions today: 3');
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
