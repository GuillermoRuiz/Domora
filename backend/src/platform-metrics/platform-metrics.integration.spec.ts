import { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  purgeAdministrator,
} from '../testing/db-fixtures';
import { PlatformMetricsService } from './platform-metrics.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: the snapshot upsert, the `notIn` cleanup and the
 * series queries (`aggregate _min`, `distinct`). Uses months of 2001 so it
 * never touches the snapshots of the real current month in a shared database.
 */
const prisma = createPrismaClient();
const service = new PlatformMetricsService(prisma as unknown as PrismaService);
const MARCH = new Date('2001-03-01T00:00:00Z');
const APRIL = new Date('2001-04-01T00:00:00Z');
const created: string[] = [];

async function despacho(
  data: Record<string, unknown>,
  subscription?: { status: 'trialing' | 'active' },
) {
  const { administratorId } = await createAdministrator(prisma);
  created.push(administratorId);
  await prisma.administrator.update({ where: { id: administratorId }, data });
  if (subscription) {
    await prisma.administratorSubscription.create({
      data: {
        administratorId,
        stripeCustomerId: `cus_${administratorId}`,
        stripeSubscriptionId: `sub_${administratorId}`,
        status: subscription.status,
      },
    });
  }
  return administratorId;
}

const ours = (month: Date) =>
  prisma.clientMrrSnapshot.findMany({
    where: { month, administratorId: { in: created } },
    orderBy: { mrr: 'asc' },
  });

afterAll(async () => {
  await prisma.clientMrrSnapshot.deleteMany({
    where: { month: { in: [MARCH, APRIL] } },
  });
  for (const id of created) {
    await prisma.administratorSubscription.deleteMany({
      where: { administratorId: id },
    });
    await purgeAdministrator(prisma, id);
  }
  await prisma.$disconnect();
});

it('captures paying clients, keeps the month idempotent and drops the ones that stop paying', async () => {
  const manual = await despacho({
    mrr: 80,
    discountPct: 20,
    discountUntil: new Date('2001-03-01'),
  });
  const trial = await despacho({ mrr: 49 }, { status: 'trialing' });
  await despacho({ mrr: 300, deletedAt: new Date('2001-01-01') });

  await service.captureCurrentMonth(new Date('2001-03-15T12:00:00Z'));
  await service.captureCurrentMonth(new Date('2001-03-20T12:00:00Z'));
  expect(
    (await ours(MARCH)).map((r) => [r.administratorId, Number(r.mrr)]),
  ).toEqual([[manual, 100]]);

  await prisma.administratorSubscription.update({
    where: { administratorId: trial },
    data: { status: 'active' },
  });
  await prisma.administrator.update({
    where: { id: manual },
    data: { status: 'Bloqueada' },
  });
  await service.captureCurrentMonth(new Date('2001-03-31T12:00:00Z'));
  expect(
    (await ours(MARCH)).map((r) => [r.administratorId, Number(r.mrr)]),
  ).toEqual([[trial, 49]]);
});

it('keeps one business event per external reference and lists it in the recent activity', async () => {
  const id = await despacho({ name: 'Despacho actividad integración' });
  const event = {
    administratorId: id,
    type: 'payment_received' as const,
    title: 'Pago recibido: 49,00 €',
    externalRef: `stripe-invoice-paid:in_${id}`,
  };

  await prisma.adminActivityItem.createMany({
    data: [event],
    skipDuplicates: true,
  });
  await prisma.adminActivityItem.createMany({
    data: [event],
    skipDuplicates: true,
  });

  expect(
    await prisma.adminActivityItem.count({
      where: { externalRef: event.externalRef },
    }),
  ).toBe(1);
  const recent = await service.recentActivity(50);
  expect(recent.find((e) => e.administrator.id === id)).toMatchObject({
    type: 'payment_received',
    administrator: { name: 'Despacho actividad integración' },
  });
});

it('builds the series from the first captured month with its movements', async () => {
  const overview = await service.mrrOverview(new Date('2001-04-10T12:00:00Z'));

  expect(overview.dataSince).toBe('2001-03');
  expect(overview.months.map((m) => m.month)).toEqual(['2001-03', '2001-04']);
  const march = overview.months[0];
  expect(march.mrr).toBeGreaterThanOrEqual(49);
  expect(march.movements.new).toBe(march.mrr);
});
