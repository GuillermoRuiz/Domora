import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../usage/usage.service';
import {
  createAdministrator,
  purgeAdministrator,
  roleA,
  uniqueEmail,
} from '../testing/db-fixtures';
import { ClientsService } from './clients.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: the per-client data the Clientes screen adds to
 * `/admins` and `/client-health/offices` (S13) — next renewal, last activity
 * from the usage log and the commercial next action and follow-ups.
 */
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const usage = new UsageService(db);
const created: string[] = [];
const staffIds: string[] = [];

/** Health is not under test here: every despacho is reported Activo. */
const health = {
  overview: jest.fn(async () => ({
    atRiskBelow: 70,
    churnRisk: 0,
    offices: created.map((administratorId) => ({
      administratorId,
      clientStatus: 'Activo',
    })),
  })),
};
const clients = new ClientsService(db, health as never, usage);

afterAll(async () => {
  for (const id of created) await purgeAdministrator(prisma, id);
  await prisma.user.deleteMany({ where: { id: { in: staffIds } } });
  await prisma.$disconnect();
});

async function despacho(name: string) {
  const fx = await createAdministrator(prisma, { name });
  created.push(fx.administratorId);
  return fx;
}

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

it('reads the next renewal of an annual Stripe client and of a manual term contract', async () => {
  const annual = await despacho('Clientes anual');
  await prisma.administrator.update({
    where: { id: annual.administratorId },
    data: { mrr: 49, billingInterval: 'year' },
  });
  await prisma.administratorSubscription.create({
    data: {
      administratorId: annual.administratorId,
      stripeCustomerId: `cus_${randomUUID()}`,
      stripeSubscriptionId: `sub_${randomUUID()}`,
      status: 'active',
      currentPeriodEnd: inDays(30),
    },
  });
  const term = await despacho('Clientes plazo');
  await prisma.administrator.update({
    where: { id: term.administratorId },
    data: { mrr: 20, endDate: inDays(120) },
  });
  const monthly = await despacho('Clientes mensual');
  await prisma.administrator.update({
    where: { id: monthly.administratorId },
    data: { mrr: 20 },
  });

  const { clients: rows } = await clients.overview();
  const byId = new Map(rows.map((r) => [r.administratorId, r]));
  expect(byId.get(annual.administratorId)?.nextRenewal).toEqual({
    date: inDays(30).toISOString().slice(0, 10),
    amount: 588,
  });
  expect(byId.get(term.administratorId)?.nextRenewal).toEqual({
    date: inDays(120).toISOString().slice(0, 10),
    amount: 240,
  });
  expect(byId.get(monthly.administratorId)?.nextRenewal).toBeNull();
});

it('última actividad is the last day any user of the despacho was active, whatever the window', async () => {
  const fx = await despacho('Clientes actividad');
  const quiet = await despacho('Clientes sin actividad');
  await prisma.userDailyActivity.createMany({
    data: [
      {
        day: new Date('2001-03-01'),
        userId: fx.userId,
        role: 'B',
        administratorId: fx.administratorId,
        modules: ['estates'],
        requests: 3,
      },
      {
        day: new Date('2001-03-09'),
        userId: fx.userId,
        role: 'B',
        administratorId: fx.administratorId,
        modules: ['receipts'],
        requests: 1,
      },
    ],
  });

  const lastActive = await usage.lastActiveDays([
    fx.administratorId,
    quiet.administratorId,
  ]);
  expect(lastActive).toEqual(new Map([[fx.administratorId, '2001-03-09']]));
  const { clients: rows } = await clients.overview();
  expect(
    rows.find((r) => r.administratorId === fx.administratorId)?.lastActiveDay,
  ).toBe('2001-03-09');
  expect(
    rows.find((r) => r.administratorId === quiet.administratorId)
      ?.lastActiveDay,
  ).toBeNull();
});

it('stores the próxima acción of a client and its follow-ups without touching the despacho record', async () => {
  const fx = await despacho('Clientes próxima acción');
  const staff = await prisma.user.create({
    data: {
      email: uniqueEmail('staff'),
      passwordHash: 'x',
      fullName: 'Comercial Clientes',
      role: 'A',
    },
  });
  staffIds.push(staff.id);
  const before = await prisma.administrator.findUniqueOrThrow({
    where: { id: fx.administratorId },
  });

  await clients.setNextAction(fx.administratorId, {
    nextAction: 'Revisar la renovación',
    nextActionAt: '2026-12-01',
  });
  let row = (await clients.overview()).clients.find(
    (r) => r.administratorId === fx.administratorId,
  )!;
  expect(row).toMatchObject({
    nextAction: 'Revisar la renovación',
    nextActionAt: '2026-12-01',
  });

  await clients.setNextAction(fx.administratorId, {
    nextAction: null,
    nextActionAt: null,
  });
  row = (await clients.overview()).clients.find(
    (r) => r.administratorId === fx.administratorId,
  )!;
  expect(row).toMatchObject({ nextAction: null, nextActionAt: null });

  await clients.addFollowUp(
    fx.administratorId,
    { text: 'Llamada de seguimiento' },
    roleA(staff.id),
  );
  const followUps = await clients.followUps(fx.administratorId);
  expect(followUps).toEqual([
    expect.objectContaining({
      text: 'Llamada de seguimiento',
      author: 'Comercial Clientes',
    }),
  ]);
  expect(
    await prisma.commercialFollowUp.count({
      where: { administratorId: fx.administratorId, leadId: null },
    }),
  ).toBe(1);

  const after = await prisma.administrator.findUniqueOrThrow({
    where: { id: fx.administratorId },
  });
  expect(after.updatedAt).toEqual(before.updatedAt);
});

it('the database refuses a follow-up attached to both a lead and a despacho', async () => {
  const fx = await despacho('Clientes check');
  const lead = await prisma.lead.create({
    data: { name: 'Lead check', origin: 'web' },
  });
  try {
    await expect(
      prisma.commercialFollowUp.create({
        data: {
          leadId: lead.id,
          administratorId: fx.administratorId,
          text: 'x',
        },
      }),
    ).rejects.toThrow();
  } finally {
    await prisma.lead.delete({ where: { id: lead.id } });
  }
});
