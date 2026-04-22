import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const DEMO_COACH_ID = 'demo-coach';
const DEMO_COACH_PHONE = '+15555550100';

const PARENTS = [
  { name: 'Alice Chen',   phone: '+15555550101', kid: { name: 'Priya Chen',   age: 11 } },
  { name: 'Ben Okafor',   phone: '+15555550102', kid: { name: 'Noah Okafor',  age: 9  } },
  { name: 'Carla Duarte', phone: '+15555550103', kid: { name: 'Mateo Duarte', age: 13 } },
  { name: 'Divya Patel',  phone: '+15555550104', kid: { name: 'Aarav Patel',  age: 10 } },
  { name: 'Elena Rossi',  phone: '+15555550105', kid: { name: 'Luca Rossi',   age: 12 } },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  const coach = await prisma.coach.upsert({
    where: { id: DEMO_COACH_ID },
    create: {
      id: DEMO_COACH_ID,
      name: 'Coach Demo',
      phone: DEMO_COACH_PHONE,
      timezone: 'America/Los_Angeles',
    },
    update: {},
  });

  for (const p of PARENTS) {
    const parent = await prisma.parent.upsert({
      where: { coachId_phone: { coachId: coach.id, phone: p.phone } },
      create: {
        coachId: coach.id,
        name: p.name,
        phone: p.phone,
        preferredChannel: 'SMS',
      },
      update: {},
    });

    await prisma.kid.upsert({
      where: { id: `kid-${parent.id}` },
      create: {
        id: `kid-${parent.id}`,
        coachId: coach.id,
        parentId: parent.id,
        name: p.kid.name,
        age: p.kid.age,
      },
      update: {},
    });
  }

  const kids = await prisma.kid.findMany({
    where: { coachId: coach.id },
    orderBy: { createdAt: 'asc' },
  });

  const now = new Date();
  const plan = [
    ...kids.map((k, i) => ({ kidId: k.id, offsetDays: -(i + 1) * 3, status: 'COMPLETED' as const, paid: true })),
    ...kids.map((k, i) => ({ kidId: k.id, offsetDays: (i + 1) * 2,  status: 'CONFIRMED' as const, paid: false })),
  ];

  for (const [i, s] of plan.entries()) {
    const scheduledAt = new Date(now);
    scheduledAt.setDate(scheduledAt.getDate() + s.offsetDays);
    scheduledAt.setHours(16, 0, 0, 0);

    await prisma.session.upsert({
      where: { id: `session-${i}` },
      create: {
        id: `session-${i}`,
        coachId: coach.id,
        kidId: s.kidId,
        scheduledAt,
        durationMinutes: 60,
        status: s.status,
        paid: s.paid,
        paymentMethod: s.paid ? 'CASH' : null,
      },
      update: {},
    });
  }

  const counts = {
    coaches: await prisma.coach.count(),
    parents: await prisma.parent.count(),
    kids: await prisma.kid.count(),
    sessions: await prisma.session.count(),
  };

  console.log('Seed complete:', counts);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
