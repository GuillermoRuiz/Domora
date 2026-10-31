import { ForbiddenException } from '@nestjs/common';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { ManagerPerformanceService } from './manager-performance.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** «Hoy» fijo a 15-jun-2024 para que el ejercicio vigente sea 2024. */
const prisma = createPrismaClient();
const service = new ManagerPerformanceService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
);
const TODAY = new Date('2024-06-15T10:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

let admin: AdministratorFixture;
let other: AdministratorFixture;
const estates: string[] = [];
let foreignEstate: string;
let user: AuthenticatedUser;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (ranking)',
  });
  other = await createAdministrator(prisma, { name: 'Otra gestora (ranking)' });
  const cutoverDate = new Date(Date.UTC(2023, 0, 1));
  // 12 fincas: la i factura (i + 1) × 100 € en 2024, así que la 12ª es la primera del ranking.
  for (let i = 0; i < 12; i++) {
    const id = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate,
      estate: { name: `Finca ${String(i + 1).padStart(2, '0')} — ranking` },
    });
    estates.push(id);
    const property = await createProperty(prisma, id);
    await issueTestReceipt(prisma, {
      estateId: id,
      propertyId: property,
      periodKey: '2024-03',
      amount: String((i + 1) * 100),
      status: 'Pagada',
    });
  }
  foreignEstate = await createLedgerEstate(prisma, other.administratorId, {
    cutoverDate,
    estate: { name: 'Finca ajena — ranking' },
  });
  await issueTestReceipt(prisma, {
    estateId: foreignEstate,
    propertyId: await createProperty(prisma, foreignEstate),
    periodKey: '2024-03',
    amount: '99999',
    status: 'Pagada',
  });
  user = roleB(admin, estates);

  // Incidencias de la 12ª (la primera): 1 devuelta + 1 impago vencido en OTRA propiedad + 2 recibos de la misma
  // propiedad con impago (cuenta una sola) + 1 pendiente sin vencer (no cuenta) + 1 pagada (no cuenta).
  const top = estates[11]!;
  const [a, b, c, d, e] = [
    await createProperty(prisma, top),
    await createProperty(prisma, top),
    await createProperty(prisma, top),
    await createProperty(prisma, top),
    await createProperty(prisma, top),
  ];
  await issueTestReceipt(prisma, {
    estateId: top,
    propertyId: a,
    periodKey: '2023-12',
    amount: '10',
    status: 'Devuelto',
  });
  await issueTestReceipt(prisma, {
    estateId: top,
    propertyId: b,
    periodKey: '2024-01',
    amount: '10',
    status: 'Pendiente',
    dueDate: day('2024-02-05'),
  });
  await issueTestReceipt(prisma, {
    estateId: top,
    propertyId: b,
    periodKey: '2024-02',
    amount: '10',
    status: 'Pendiente',
    dueDate: day('2024-03-05'),
  });
  await issueTestReceipt(prisma, {
    estateId: top,
    propertyId: c,
    periodKey: '2024-06',
    amount: '10',
    status: 'Pendiente',
    dueDate: day('2024-07-05'),
  });
  await issueTestReceipt(prisma, {
    estateId: top,
    propertyId: d,
    periodKey: '2024-04',
    amount: '10',
    status: 'Pagada',
    dueDate: day('2024-04-05'),
  });
  void e;
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, other.administratorId);
  await prisma.$disconnect();
});

describe('ManagerPerformanceService.ranking', () => {
  it('Top 10 por volumen facturado del ejercicio, de mayor a menor, solo con las fincas del gestor', async () => {
    const { items, selected, total } = await service.ranking(
      user,
      undefined,
      TODAY,
    );
    expect(total).toBe(12);
    expect(items).toHaveLength(10);
    expect(items.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // La 12ª factura 1200 € + 40 € de las incidencias de prueba (2023-12 queda fuera del ejercicio, 2024: 1200 + 40).
    expect(items[0]).toMatchObject({
      estateId: estates[11],
      name: 'Finca 12 — ranking',
    });
    expect(items.map((r) => r.billed)).toEqual(
      [...items.map((r) => r.billed)].sort((a, b) => b - a),
    );
    expect(items.some((r) => r.estateId === foreignEstate)).toBe(false);
    expect(selected).toBeNull();
  });

  it('incidencias: propiedades con recibo devuelto o impago vencido, contadas una vez; Al día = 0', async () => {
    const { items } = await service.ranking(user, undefined, TODAY);
    expect(items[0]).toMatchObject({ incidents: 2, status: 'con_incidencias' });
    expect(items[1]).toMatchObject({ incidents: 0, status: 'al_dia' });
  });

  it('una finca fuera del Top 10 se añade como fila extra con su posición real', async () => {
    const { items, selected } = await service.ranking(user, estates[0], TODAY);
    expect(items.some((r) => r.estateId === estates[0])).toBe(false);
    expect(selected).toMatchObject({ estateId: estates[0], rank: 12 });
  });

  it('una finca elegida que ya está en el Top 10 no genera fila extra y el orden no cambia', async () => {
    const base = await service.ranking(user, undefined, TODAY);
    const withSelection = await service.ranking(user, estates[10], TODAY);
    expect(withSelection.selected).toBeNull();
    expect(withSelection.items.map((r) => r.estateId)).toEqual(
      base.items.map((r) => r.estateId),
    );
  });

  it('una finca ajena es 403; un gestor sin fincas recibe un ranking vacío', async () => {
    await expect(
      service.ranking(user, foreignEstate, TODAY),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(await service.ranking(roleB(other, []), undefined, TODAY)).toEqual({
      items: [],
      selected: null,
      total: 0,
    });
  });
});
