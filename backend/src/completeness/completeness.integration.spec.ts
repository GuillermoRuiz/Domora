import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateSetupService } from '../estates/estate-setup.service';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  purgeAdministrator,
  uniqueEmail,
} from '../testing/db-fixtures';
import { CompletenessService } from './completeness.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: the batched despacho query (filtered relation counts,
 * primary user, billing, subscription), the estate checklist reused from
 * `EstateSetupService` and the once-only `onboarding_completed` event.
 */
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const service = new CompletenessService(db, new EstateSetupService(db));
const created: { administratorId: string; extraUsers: string[] }[] = [];

afterAll(async () => {
  for (const { administratorId, extraUsers } of created) {
    await prisma.teamInvite.deleteMany({ where: { administratorId } });
    await prisma.administrator.update({
      where: { id: administratorId },
      data: { primaryUserId: null },
    });
    await purgeAdministrator(prisma, administratorId, extraUsers);
  }
  await prisma.$disconnect();
});

async function despacho() {
  const fx = await createAdministrator(prisma, {
    name: 'Despacho completitud',
  });
  const entry = {
    administratorId: fx.administratorId,
    extraUsers: [] as string[],
  };
  created.push(entry);
  return { ...fx, entry };
}

/** An estate whose required steps are all done (cif, one property with quota, coefficient 100 and an owner). */
async function readyEstate(
  administratorId: string,
  entry: { extraUsers: string[] },
) {
  const estateId = await createEstate(prisma, administratorId, {
    cif: 'H12345678',
  });
  const propertyId = await createProperty(prisma, estateId);
  await prisma.property.update({
    where: { id: propertyId },
    data: { quotaMonthly: 50, participationQuota: 100 },
  });
  const ownerId = await createOwnerUser(prisma);
  entry.extraUsers.push(ownerId);
  await prisma.propertyMembership.create({
    data: {
      propertyId,
      userId: ownerId,
      roleType: 'Propietario',
      status: 'linked',
      linkedAt: new Date(),
    },
  });
  return estateId;
}

it('derives every despacho step from the stored data, in one batch for the list', async () => {
  const bare = await despacho();
  const full = await despacho();
  await prisma.administrator.update({
    where: { id: full.administratorId },
    data: {
      primaryUserId: full.userId,
      contactName: 'Ana',
      contactEmail: 'ana@test.local',
      phone: '600000000',
    },
  });
  await prisma.user.update({
    where: { id: full.userId },
    data: { totpEnabled: true },
  });
  await prisma.adminBilling.create({
    data: {
      administratorId: full.administratorId,
      businessName: 'Despacho SL',
      cif: 'B12345678',
      address: 'Calle 1',
      email: 'f@test.local',
      paymentMethod: 'Domiciliacion',
      iban: 'ES9121000418450200051332',
    },
  });
  await prisma.user.create({
    data: {
      email: uniqueEmail('colega'),
      passwordHash: 'x',
      fullName: 'Colega',
      role: 'B',
      administratorId: full.administratorId,
    },
  });
  await createEstate(prisma, full.administratorId);
  await createEstate(prisma, full.administratorId, { deletedAt: new Date() });

  const overview = await service.overview();
  const row = (id: string) =>
    overview.offices.find((o) => o.administratorId === id)!;
  expect(row(bare.administratorId)).toMatchObject({
    office: 0,
    estates: 0,
    total: 0,
    estateCount: 0,
    onboardingComplete: false,
  });
  // contact, billing, payment, estates, 2FA → 5/5 counted steps; one bare estate.
  expect(row(full.administratorId)).toMatchObject({
    office: 100,
    estateCount: 1,
    onboardingComplete: false,
  });

  const detail = await service.detail(full.administratorId);
  expect(detail.officeSteps.map((s) => [s.key, s.status])).toEqual([
    ['contact', 'done'],
    ['billing', 'done'],
    ['payment', 'done'],
    ['estates', 'done'],
    ['team', 'done'],
    ['twoFactor', 'done'],
  ]);
  expect(detail.estateDetails).toHaveLength(1);
  expect(detail.estateDetails[0].steps.map((s) => s.key)).toContain('fiscal');
  expect(
    (await service.detail(bare.administratorId)).officeSteps.filter(
      (s) => s.status === 'done',
    ),
  ).toEqual([]);
});

it('logs «onboarding completado» exactly once, when the despacho and all its estates have their required steps', async () => {
  const fx = await despacho();
  await prisma.adminBilling.create({
    data: {
      administratorId: fx.administratorId,
      businessName: 'Despacho SL',
      cif: 'B12345678',
      address: 'Calle 1',
      email: 'f@test.local',
      paymentMethod: 'Transferencia',
    },
  });
  // Only this test's despacho: the database is shared with the demo data.
  const record = () =>
    service.recordOnboardingCompletions(new Date(), { id: fx.administratorId });
  const events = () =>
    prisma.adminActivityItem.findMany({
      where: {
        administratorId: fx.administratorId,
        type: 'onboarding_completed',
      },
    });

  await record();
  expect(await events()).toHaveLength(0); // no estate yet

  await readyEstate(fx.administratorId, fx.entry);
  await record();
  await record();
  const logged = await events();
  expect(logged).toHaveLength(1);
  expect(logged[0]).toMatchObject({
    externalRef: `onboarding-completed:${fx.administratorId}`,
    title: 'Onboarding completado',
  });
  expect((await service.detail(fx.administratorId)).onboardingComplete).toBe(
    true,
  );
});

it('a deleted or unknown despacho has no detail', async () => {
  const fx = await despacho();
  await prisma.administrator.update({
    where: { id: fx.administratorId },
    data: { deletedAt: new Date() },
  });
  await expect(service.detail(fx.administratorId)).rejects.toBeInstanceOf(
    NotFoundException,
  );
});
