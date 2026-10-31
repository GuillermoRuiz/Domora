import { ForbiddenException } from '@nestjs/common';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createSupplier,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { ManagerMilestonesService } from './manager-milestones.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** Integración contra Postgres real: ventana de 30 días, qué entra y qué no, orden y ámbito. */
const prisma = createPrismaClient();
const service = new ManagerMilestonesService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
);

const DAY = 86_400_000;
const now = new Date();
const today = new Date(
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
);
const day = (offset: number) => new Date(today.getTime() + offset * DAY);

let admin: AdministratorFixture;
let other: AdministratorFixture;
let estate: string;
let secondEstate: string;
let foreignEstate: string;
let user: AuthenticatedUser;

function meeting(
  estateId: string,
  title: string,
  status: 'convocada' | 'celebrada' | 'cancelada',
  offsetDays: number,
) {
  const at = new Date(now.getTime() + offsetDays * DAY);
  return prisma.meeting.create({
    data: {
      estateId,
      title,
      type: 'ordinaria',
      status,
      scheduledAt1: at,
      scheduledAt2: new Date(at.getTime() + 30 * 60_000),
      agenda: [],
      convokedBy: 'presidente',
      signerRole: 'administrador',
      createdByUserId: admin.userId,
    },
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (hitos)',
  });
  other = await createAdministrator(prisma, { name: 'Otra gestora (hitos)' });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca A — hitos' },
  });
  secondEstate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca B — hitos' },
  });
  foreignEstate = await createLedgerEstate(prisma, other.administratorId, {
    estate: { name: 'Finca ajena — hitos' },
  });
  user = roleB(admin, [estate, secondEstate]);

  // Juntas: +3 días (entra), +45 (fuera), celebrada +2 (no), cancelada +4 (no), ajena +1 (no).
  await meeting(estate, 'Junta próxima', 'convocada', 3);
  await meeting(estate, 'Junta lejana', 'convocada', 45);
  await meeting(estate, 'Junta celebrada', 'celebrada', 2);
  await meeting(estate, 'Junta cancelada', 'cancelada', 4);
  await meeting(foreignEstate, 'Junta ajena', 'convocada', 1);

  // Revisiones: cita a +8 (entra, manda sobre el vencimiento), vencimiento a +20 (entra), +60 (fuera),
  // vencida hace 5 días (no es un hito), realizada (no).
  const asset = await prisma.asset.create({
    data: { estateId: secondEstate, name: 'Ascensor', category: 'Ascensor' },
  });
  const type = await prisma.inspectionType.create({
    data: {
      estateId: secondEstate,
      code: 'PRUEBA',
      name: 'Inspección de prueba',
    },
  });
  const inspection = (
    status: 'planificada' | 'citada' | 'vencida' | 'realizada',
    nextDueDate: Date,
    appointmentDate: Date | null = null,
  ) =>
    prisma.regulatoryInspection.create({
      data: {
        estateId: secondEstate,
        assetId: asset.id,
        inspectionTypeId: type.id,
        createdByUserId: admin.userId,
        status,
        nextDueDate,
        appointmentDate,
      },
    });
  await inspection('citada', day(40), day(8));
  await inspection('planificada', day(20));
  await inspection('planificada', day(60));
  await inspection('vencida', day(-5));
  await inspection('realizada', day(10));

  // Contratos: +10 (entra), +31 (fuera), vencido (fuera), cancelado +5 (no).
  const supplier = await createSupplier(prisma, estate, admin.administratorId, {
    name: 'Ascensores Prueba S.L.',
  });
  const contract = (offset: number, cancelled = false) =>
    prisma.supplierContract.create({
      data: {
        supplierId: supplier,
        estateId: estate,
        serviceType: 'Ascensores',
        startDate: day(offset - 365),
        endDate: day(offset),
        renewalType: 'manual',
        cancelledAt: cancelled ? new Date() : null,
      },
    });
  await contract(10);
  await contract(31);
  await contract(-3);
  await contract(5, true);
});

afterAll(async () => {
  const ids = [estate, secondEstate, foreignEstate];
  await prisma.regulatoryInspection.deleteMany({
    where: { estateId: { in: ids } },
  });
  await prisma.inspectionType.deleteMany({ where: { estateId: { in: ids } } });
  await prisma.supplierContract.deleteMany({
    where: { estateId: { in: ids } },
  });
  await prisma.asset.deleteMany({ where: { estateId: { in: ids } } });
  await prisma.meeting.deleteMany({ where: { estateId: { in: ids } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, other.administratorId);
  await prisma.$disconnect();
});

describe('ManagerMilestonesService.milestones', () => {
  it('solo lo que cae en los próximos 30 días, de las dos fincas, por fecha', async () => {
    const { items } = await service.milestones(user, undefined, new Date());
    expect(items.map((i) => `${i.kind}:${i.estateName}`)).toEqual([
      'meeting:Finca A — hitos', // +3
      'inspection:Finca B — hitos', // cita +8
      'contract:Finca A — hitos', // +10
      'inspection:Finca B — hitos', // vencimiento +20
    ]);
    const dates = items.map((i) => i.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('la cita de una revisión manda sobre su vencimiento', async () => {
    const { items } = await service.milestones(user, undefined, new Date());
    const dated = items
      .filter((i) => i.kind === 'inspection')
      .map((i) => i.date);
    expect(dated).toEqual([
      day(8).toISOString().slice(0, 10),
      day(20).toISOString().slice(0, 10),
    ]);
  });

  it('cada hito apunta a su gestión', async () => {
    const { items } = await service.milestones(user, undefined, new Date());
    expect(new Set(items.map((i) => i.target.section))).toEqual(
      new Set(['juntas', 'instalaciones', 'proveedores']),
    );
    expect(
      items.every((i) => i.target.estateId === i.estateId && i.target.refId),
    ).toBe(true);
  });

  it('con una finca elegida solo salen sus hitos', async () => {
    const { items } = await service.milestones(user, secondEstate, new Date());
    expect(items.map((i) => i.kind)).toEqual(['inspection', 'inspection']);
  });

  it('una finca ajena es 403; un gestor sin fincas recibe una lista vacía', async () => {
    await expect(
      service.milestones(user, foreignEstate, new Date()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await service.milestones(roleB(other, []), undefined, new Date()),
    ).toEqual({ items: [] });
  });
});
