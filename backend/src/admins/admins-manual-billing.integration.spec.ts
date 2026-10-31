import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { type SubscriptionStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateSetupService } from '../estates/estate-setup.service';
import { CompletenessService } from '../completeness/completeness.service';
import { ClientStatusService } from '../client-status/client-status.service';
import { PlatformMetricsService } from '../platform-metrics/platform-metrics.service';
import { BillingService } from '../billing/billing.service';
import type { StripeService } from '../billing/stripe.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  purgeAdministrator,
} from '../testing/db-fixtures';
import { AdminsService } from './admins.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: «Pasar a facturación manual» (odd/tasks/role-a-panel.md
 * T14, S6, S9) turns a despacho whose Stripe subscription was canceled into a
 * manually billed client for every reader — client status, MRR, completitud —
 * and a late Stripe webhook for the old subscription cannot link it again,
 * while a new checkout still works.
 */
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const completeness = new CompletenessService(db, new EstateSetupService(db));
const clientStatus = new ClientStatusService(db, completeness);
const admins = new AdminsService(
  db,
  undefined as never,
  undefined as never,
  clientStatus,
);
const metrics = new PlatformMetricsService(db);
const stripe = {
  constructWebhookEvent: jest.fn(),
  retrieveSubscription: jest.fn(),
  createSubscriptionCheckoutSession: jest
    .fn()
    .mockResolvedValue('https://checkout/new'),
  priceIdFor: jest.fn().mockReturnValue('price_base'),
  planForPriceId: jest.fn().mockReturnValue(null),
};
const notifications = {
  administratorTeamUserIds: jest.fn().mockResolvedValue([]),
  notify: jest.fn(),
};
const config = {
  get: jest.fn().mockReturnValue('http://localhost:4200'),
} as unknown as ConfigService;
const billing = new BillingService(
  db,
  stripe as unknown as StripeService,
  admins,
  config,
  notifications as unknown as NotificationsService,
);
const created: string[] = [];

afterAll(async () => {
  for (const id of created) await purgeAdministrator(prisma, id);
  await prisma.$disconnect();
});

async function despacho(name: string, stripeStatus: SubscriptionStatus) {
  const { administratorId, userId } = await createAdministrator(prisma, {
    name,
  });
  created.push(administratorId);
  const subscriptionId = `sub_${randomUUID()}`;
  const customerId = `cus_${randomUUID()}`;
  // What the webhooks leave after a Stripe cancellation: Vencida, the Stripe amount as MRR.
  await prisma.administrator.update({
    where: { id: administratorId },
    data: { status: 'Vencida', mrr: 99 },
  });
  await prisma.administratorSubscription.create({
    data: {
      administratorId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripePriceId: 'price_base',
      status: stripeStatus,
    },
  });
  const roleA: AuthenticatedUser = {
    id: userId,
    role: 'A',
    estateIds: [],
    administratorId: null,
  };
  const roleB: AuthenticatedUser = {
    id: userId,
    role: 'B',
    estateIds: [],
    administratorId,
  };
  return { administratorId, subscriptionId, customerId, roleA, roleB };
}

async function liveMrr(administratorId: string): Promise<number> {
  const contributions = await metrics['liveContributions'](new Date());
  return contributions.get(administratorId) ?? 0;
}

function webhook(type: string, object: Record<string, unknown>) {
  stripe.constructWebhookEvent.mockReturnValueOnce({ type, data: { object } });
  return billing.handleWebhookEvent(Buffer.from('{}'), 'sig');
}

it('a canceled Stripe despacho becomes a manually billed client for client status, MRR and completitud, and the change is logged', async () => {
  const d = await despacho('Despacho facturación manual', 'canceled');
  expect(
    (await clientStatus.forAdministrator(d.administratorId))?.clientStatus,
  ).toBe('Cancelado');
  expect(await liveMrr(d.administratorId)).toBe(0);
  expect((await completeness.detail(d.administratorId)).includedInAverage).toBe(
    false,
  );
  const before = await admins.findById(d.administratorId);
  expect(before).toHaveProperty('stripeSubscription');
  expect(before.stripeSubscription).toEqual({
    status: 'canceled',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    manualBillingAvailable: true,
  });
  expect(before).not.toHaveProperty('subscription');

  const result = await admins.switchToManualBilling(
    d.administratorId,
    { activate: true },
    d.roleA,
  );

  expect(result).toMatchObject({
    id: d.administratorId,
    status: 'Activa',
    clientStatus: 'En onboarding',
  });
  expect(result).not.toHaveProperty('stripeSubscription');
  expect(Number(result.mrr)).toBe(49);
  expect(await liveMrr(d.administratorId)).toBe(49);
  expect((await completeness.detail(d.administratorId)).includedInAverage).toBe(
    true,
  );

  const row = await prisma.administratorSubscription.findUniqueOrThrow({
    where: { administratorId: d.administratorId },
  });
  expect(row).toMatchObject({
    stripeCustomerId: d.customerId,
    stripeSubscriptionId: null,
    stripePriceId: null,
    status: null,
    cancelAtPeriodEnd: false,
  });
  const activity = await prisma.adminActivityItem.findMany({
    where: { administratorId: d.administratorId },
  });
  expect(activity).toEqual([
    expect.objectContaining({
      type: 'plan_change',
      authorUserId: d.roleA.id,
      externalRef: `stripe-detached:${d.subscriptionId}`,
      title: `Pasada a facturación manual: se desvincula la suscripción de Stripe ${d.subscriptionId} (cancelada) · cuenta reactivada`,
    }),
  ]);
  expect(result.activity).toHaveLength(1);
});

it('late Stripe webhooks for the detached subscription do not link it again, and a new checkout still works', async () => {
  const d = await despacho('Despacho webhook tardío', 'incomplete_expired');
  await admins.switchToManualBilling(
    d.administratorId,
    { activate: true },
    d.roleA,
  );

  const oldSubscription = {
    id: d.subscriptionId,
    customer: d.customerId,
    status: 'canceled',
    cancel_at_period_end: false,
    metadata: { administrator_id: d.administratorId },
    items: {
      data: [
        {
          price: {
            id: 'price_base',
            unit_amount: 9900,
            recurring: { interval: 'month', interval_count: 1 },
          },
          quantity: 1,
          current_period_end: 1735689600,
        },
      ],
    },
  };
  await webhook('customer.subscription.updated', oldSubscription);
  await webhook('customer.subscription.deleted', oldSubscription);
  await webhook('checkout.session.completed', {
    id: 'cs_old',
    mode: 'subscription',
    metadata: { administrator_id: d.administratorId },
    subscription: d.subscriptionId,
    customer: d.customerId,
  });
  await webhook('invoice.payment_failed', {
    id: `in_${randomUUID()}`,
    parent: { subscription_details: { subscription: d.subscriptionId } },
  });

  const after = await prisma.administratorSubscription.findUniqueOrThrow({
    where: { administratorId: d.administratorId },
  });
  expect(after).toMatchObject({
    stripeCustomerId: d.customerId,
    stripeSubscriptionId: null,
    status: null,
  });
  const admin = await prisma.administrator.findUniqueOrThrow({
    where: { id: d.administratorId },
  });
  expect(admin.status).toBe('Activa');
  expect(Number(admin.mrr)).toBe(49);
  expect(
    (await clientStatus.forAdministrator(d.administratorId))?.clientStatus,
  ).not.toBe('Cancelado');
  expect(stripe.retrieveSubscription).not.toHaveBeenCalled();

  // The despacho may go back to Stripe: same customer, a new subscription is linked normally.
  await expect(billing.createCheckoutSession(d.roleB)).resolves.toEqual({
    url: 'https://checkout/new',
  });
  expect(stripe.createSubscriptionCheckoutSession).toHaveBeenCalledWith(
    expect.objectContaining({
      customerId: d.customerId,
      administratorId: d.administratorId,
    }),
  );
  const newSubscriptionId = `sub_${randomUUID()}`;
  stripe.retrieveSubscription.mockResolvedValueOnce({
    ...oldSubscription,
    id: newSubscriptionId,
    status: 'active',
  });
  await webhook('checkout.session.completed', {
    id: 'cs_new',
    mode: 'subscription',
    metadata: { administrator_id: d.administratorId },
    subscription: newSubscriptionId,
    customer: d.customerId,
  });
  expect(
    await prisma.administratorSubscription.findUniqueOrThrow({
      where: { administratorId: d.administratorId },
    }),
  ).toMatchObject({
    stripeCustomerId: d.customerId,
    stripeSubscriptionId: newSubscriptionId,
    status: 'active',
  });
});

it('a live Stripe subscription cannot be detached: 409 and nothing changes', async () => {
  const d = await despacho('Despacho Stripe vivo', 'past_due');
  expect(await admins.findById(d.administratorId)).toHaveProperty(
    'stripeSubscription',
    expect.objectContaining({
      status: 'past_due',
      manualBillingAvailable: false,
    }),
  );
  await expect(
    admins.switchToManualBilling(
      d.administratorId,
      { activate: true },
      d.roleA,
    ),
  ).rejects.toBeInstanceOf(ConflictException);
  expect(
    await prisma.administratorSubscription.findUniqueOrThrow({
      where: { administratorId: d.administratorId },
    }),
  ).toMatchObject({
    stripeSubscriptionId: d.subscriptionId,
    status: 'past_due',
  });
  expect(
    await prisma.adminActivityItem.count({
      where: { administratorId: d.administratorId },
    }),
  ).toBe(0);
});

it('an «updated» webhook that read the row just before the detach committed does not overwrite it (race)', async () => {
  const d = await despacho('Despacho carrera webhook', 'canceled');
  const original = prisma.administratorSubscription.findUnique.bind(
    prisma.administratorSubscription,
  );
  const spy = jest
    .spyOn(prisma.administratorSubscription, 'findUnique')
    .mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      // The webhook has read the still-linked row; role A detaches before it writes.
      const row = await original(args);
      await admins.switchToManualBilling(
        d.administratorId,
        { activate: true },
        d.roleA,
      );
      return row;
    }) as never);
  try {
    await webhook('customer.subscription.updated', {
      id: d.subscriptionId,
      customer: d.customerId,
      status: 'canceled',
      cancel_at_period_end: true,
      metadata: { administrator_id: d.administratorId },
      items: {
        data: [
          {
            price: {
              id: 'price_base',
              unit_amount: 9900,
              recurring: { interval: 'month', interval_count: 1 },
            },
            quantity: 1,
            current_period_end: 1735689600,
          },
        ],
      },
    });
  } finally {
    spy.mockRestore();
  }

  expect(
    await prisma.administratorSubscription.findUniqueOrThrow({
      where: { administratorId: d.administratorId },
    }),
  ).toMatchObject({
    stripeCustomerId: d.customerId,
    stripeSubscriptionId: null,
    stripePriceId: null,
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });
  const admin = await prisma.administrator.findUniqueOrThrow({
    where: { id: d.administratorId },
  });
  expect(admin.status).toBe('Activa');
  expect(Number(admin.mrr)).toBe(49);
  // Neither a «Solicitud de baja» nor an automatic restriction for the detached subscription.
  const types = (
    await prisma.adminActivityItem.findMany({
      where: { administratorId: d.administratorId },
    })
  ).map((a) => a.type);
  expect(types).toEqual(['plan_change']);
});

it('a normal «updated» webhook for a linked subscription still updates status, plan and MRR', async () => {
  const d = await despacho('Despacho Stripe actualizado', 'past_due');
  stripe.planForPriceId.mockReturnValueOnce('STANDARD');
  await webhook('customer.subscription.updated', {
    id: d.subscriptionId,
    customer: d.customerId,
    status: 'active',
    cancel_at_period_end: false,
    metadata: {},
    items: {
      data: [
        {
          price: {
            id: 'price_standard',
            unit_amount: 12900,
            recurring: { interval: 'month', interval_count: 1 },
          },
          quantity: 1,
          current_period_end: 1735689600,
        },
      ],
    },
  });

  expect(
    await prisma.administratorSubscription.findUniqueOrThrow({
      where: { administratorId: d.administratorId },
    }),
  ).toMatchObject({
    stripeSubscriptionId: d.subscriptionId,
    stripePriceId: 'price_standard',
    status: 'active',
    currentPeriodEnd: new Date(1735689600 * 1000),
  });
  const admin = await prisma.administrator.findUniqueOrThrow({
    where: { id: d.administratorId },
  });
  // The fixture left it Vencida: a confirmed «active» reactivates it, as before.
  expect(admin).toMatchObject({
    status: 'Activa',
    plan: 'STANDARD',
    usersMax: 1,
  });
  expect(Number(admin.mrr)).toBe(129);
});
