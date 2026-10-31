import { ForbiddenException } from '@nestjs/common';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  createSupplier,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import {
  adhesionUrgency,
  comparePending,
  contractUrgency,
  inspectionUrgency,
  ManagerPendingService,
  receiptUrgency,
  type PendingItem,
} from './manager-pending.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

describe('reglas de urgencia', () => {
  it('cuotas: >60 urgente, 31–60 hoy, 1–30 esta semana', () => {
    expect([
      receiptUrgency(61),
      receiptUrgency(60),
      receiptUrgency(31),
      receiptUrgency(30),
      receiptUrgency(1),
    ]).toEqual(['urgente', 'hoy', 'hoy', 'esta_semana', 'esta_semana']);
  });
  it('inspecciones: vencida urgente, ≤7 hoy, ≤30 esta semana, más lejos no entra', () => {
    expect([
      inspectionUrgency(-1),
      inspectionUrgency(0),
      inspectionUrgency(7),
      inspectionUrgency(8),
      inspectionUrgency(30),
      inspectionUrgency(31),
    ]).toEqual(['urgente', 'hoy', 'hoy', 'esta_semana', 'esta_semana', null]);
  });
  it('contratos: vencido o ≤7 urgente, ≤14 hoy, ≤30 esta semana, más lejos no entra', () => {
    expect([
      contractUrgency(-3),
      contractUrgency(7),
      contractUrgency(8),
      contractUrgency(14),
      contractUrgency(15),
      contractUrgency(30),
      contractUrgency(31),
    ]).toEqual([
      'urgente',
      'urgente',
      'hoy',
      'hoy',
      'esta_semana',
      'esta_semana',
      null,
    ]);
  });
  it('solicitudes de alta: >7 urgente, >2 hoy, el resto esta semana', () => {
    expect([
      adhesionUrgency(8),
      adhesionUrgency(7),
      adhesionUrgency(3),
      adhesionUrgency(2),
      adhesionUrgency(0),
    ]).toEqual(['urgente', 'hoy', 'hoy', 'esta_semana', 'esta_semana']);
  });
  it('orden: urgencia, luego seguridad, luego fecha más antigua, luego mayor importe', () => {
    const base: PendingItem = {
      id: 'x',
      kind: 'receipt',
      urgency: 'hoy',
      title: '',
      detail: '',
      estateId: 'e',
      estateName: 'E',
      date: '2026-01-10',
      amount: null,
      safety: false,
      target: { section: 'cuotas', estateId: 'e', refId: null },
    };
    const items = [
      { ...base, id: 'a', urgency: 'esta_semana' as const },
      { ...base, id: 'b', urgency: 'urgente' as const, date: '2026-03-01' },
      {
        ...base,
        id: 'c',
        urgency: 'urgente' as const,
        date: '2026-04-01',
        safety: true,
      },
      { ...base, id: 'd', urgency: 'urgente' as const, date: '2026-02-01' },
      {
        ...base,
        id: 'e',
        urgency: 'urgente' as const,
        date: '2026-02-01',
        amount: 500,
      },
    ];
    expect([...items].sort(comparePending).map((i) => i.id)).toEqual([
      'c',
      'e',
      'd',
      'b',
      'a',
    ]);
  });
});

/** Integración contra Postgres real: qué entra, con qué etiqueta y que solo se vea lo del gestor. */
const prisma = createPrismaClient();
const service = new ManagerPendingService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
);

const DAY = 86_400_000;
const now = new Date();
const day = (offset: number) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      offset * DAY,
  );
const periodOf = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

let admin: AdministratorFixture;
let other: AdministratorFixture;
let estate: string;
let foreignEstate: string;
let user: AuthenticatedUser;
let _seq = 0;

const [p1, p2, p3, p4] = [0, 1, 2, 3].map(() => '');
const props: string[] = [p1, p2, p3, p4];

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (pendientes)',
  });
  other = await createAdministrator(prisma, {
    name: 'Otra gestora (pendientes)',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2000, 0, 1)),
    estate: { name: 'Finca de prueba — pendientes' },
  });
  foreignEstate = await createLedgerEstate(prisma, other.administratorId, {
    cutoverDate: new Date(Date.UTC(2000, 0, 1)),
    estate: { name: 'Finca ajena — pendientes' },
  });
  user = roleB(admin, [estate]);
  for (let i = 0; i < 4; i++) props[i] = await createProperty(prisma, estate);
  const foreignProperty = await createProperty(prisma, foreignEstate);

  // Cuotas: p0 con dos vencidas (la más vieja a 70 días => urgente, una sola fila), p1 a 40 días (hoy),
  // p2 sin vencer, p3 pagada.
  const due = (offset: number) => day(offset);
  await issueTestReceipt(prisma, {
    estateId: estate,
    propertyId: props[0]!,
    periodKey: periodOf(due(-70)),
    amount: '100.00',
    status: 'Pendiente',
    dueDate: due(-70),
  });
  await issueTestReceipt(prisma, {
    estateId: estate,
    propertyId: props[0]!,
    periodKey: periodOf(due(-10)),
    amount: '50.00',
    status: 'Pendiente',
    dueDate: due(-10),
  });
  await issueTestReceipt(prisma, {
    estateId: estate,
    propertyId: props[1]!,
    periodKey: periodOf(due(-40)),
    amount: '80.00',
    status: 'Devuelto',
    dueDate: due(-40),
  });
  await issueTestReceipt(prisma, {
    estateId: estate,
    propertyId: props[2]!,
    periodKey: periodOf(due(5)),
    amount: '60.00',
    status: 'Pendiente',
    dueDate: due(5),
  });
  await issueTestReceipt(prisma, {
    estateId: estate,
    propertyId: props[3]!,
    periodKey: periodOf(due(-90)),
    amount: '70.00',
    status: 'Pagada',
    dueDate: due(-90),
  });
  await issueTestReceipt(prisma, {
    estateId: foreignEstate,
    propertyId: foreignProperty,
    periodKey: periodOf(due(-90)),
    amount: '999.00',
    status: 'Pendiente',
    dueDate: due(-90),
  });

  // Instalaciones: ascensor fuera de servicio (seguridad), piscina fuera de servicio, otra operativa.
  const lift = await prisma.asset.create({
    data: {
      estateId: estate,
      name: 'Ascensor',
      category: 'Ascensor',
      operationalStatus: 'fuera_de_servicio',
    },
  });
  await prisma.asset.create({
    data: {
      estateId: estate,
      name: 'Piscina',
      category: 'Piscina',
      operationalStatus: 'fuera_de_servicio',
    },
  });
  await prisma.asset.create({
    data: {
      estateId: estate,
      name: 'Puerta',
      category: 'Accesos',
      operationalStatus: 'operativa',
    },
  });

  // Inspecciones: vencida, +5 días (hoy), +20 (esta semana), +60 (no entra), realizada (no entra).
  const type = await prisma.inspectionType.create({
    data: { estateId: estate, code: 'PRUEBA', name: 'Inspección de prueba' },
  });
  const inspection = (
    status: 'planificada' | 'vencida' | 'realizada',
    offset: number,
  ) =>
    prisma.regulatoryInspection.create({
      data: {
        estateId: estate,
        assetId: lift.id,
        inspectionTypeId: type.id,
        createdByUserId: admin.userId,
        status,
        nextDueDate: day(offset),
      },
    });
  await inspection('vencida', -12);
  await inspection('planificada', 5);
  await inspection('planificada', 20);
  await inspection('planificada', 60);
  await inspection('realizada', 3);

  // Contratos: +10 (hoy), +25 (esta semana), +40 (no), -50 (no), cancelado +3 (no).
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
  await contract(25);
  await contract(40);
  await contract(-50);
  await contract(3, true);

  // Solicitudes pendientes de 10, 4 y 1 días + una resuelta (no entra) + una ajena.
  const requester = async () => createOwnerUser(prisma);
  const request = async (
    ageDays: number,
    status: 'pending' | 'approved',
    estateId = estate,
  ) => {
    _seq += 1;
    return prisma.adhesionRequest.create({
      data: {
        estateId,
        userId: await requester(),
        roleType: 'Propietario',
        submittedAt: new Date(now.getTime() - ageDays * DAY),
        status,
        resolvedAt: status === 'approved' ? new Date() : null,
      },
    });
  };
  await request(10, 'pending');
  await request(4, 'pending');
  await request(1, 'pending');
  await request(20, 'approved');
  await request(30, 'pending', foreignEstate);
});

afterAll(async () => {
  const ids = [estate, foreignEstate];
  await prisma.regulatoryInspection.deleteMany({
    where: { estateId: { in: ids } },
  });
  await prisma.inspectionType.deleteMany({ where: { estateId: { in: ids } } });
  await prisma.supplierContract.deleteMany({
    where: { estateId: { in: ids } },
  });
  await prisma.asset.deleteMany({ where: { estateId: { in: ids } } });
  await prisma.adhesionRequest.deleteMany({ where: { estateId: { in: ids } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, other.administratorId);
  await prisma.$disconnect();
});

describe('ManagerPendingService.pendingToday', () => {
  it('entra solo lo que toca, con su etiqueta y en orden', async () => {
    const result = await service.pendingToday(user, undefined, new Date());
    const summary = result.items.map((i) => `${i.urgency}:${i.kind}`);
    // 2 cuotas (p0 agrupada, p1), 2 instalaciones fuera de servicio, 3 inspecciones, 2 contratos, 3 solicitudes.
    expect(result.total).toBe(12);
    expect(result.items).toHaveLength(12);
    expect(summary.filter((s) => s.startsWith('urgente'))).toEqual(
      expect.arrayContaining([
        'urgente:receipt',
        'urgente:installation',
        'urgente:inspection',
        'urgente:adhesion',
      ]),
    );
    expect(summary).toContain('hoy:receipt');
    expect(summary).toContain('hoy:inspection');
    expect(summary).toContain('hoy:contract');
    expect(summary).toContain('esta_semana:contract');
    expect(summary).toContain('esta_semana:adhesion');
    // Ordenadas: nunca una etiqueta menos urgente antes que otra más urgente.
    const rank = { urgente: 0, hoy: 1, esta_semana: 2 };
    const ranks = result.items.map((i) => rank[i.urgency]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('las cuotas se agrupan por propiedad: una fila con el total y la antigüedad de la más vieja', async () => {
    const result = await service.pendingToday(user, undefined, new Date());
    const rows = result.items.filter((i) => i.kind === 'receipt');
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.target.refId === props[0]);
    expect(first).toMatchObject({ urgency: 'urgente', amount: 150 });
    expect(rows.find((r) => r.target.refId === props[1])).toMatchObject({
      urgency: 'hoy',
      amount: 80,
    });
  });

  it('entre los urgentes, la seguridad va primero: el ascensor fuera de servicio antes que la piscina', async () => {
    const result = await service.pendingToday(user, undefined, new Date());
    const installs = result.items.filter((i) => i.kind === 'installation');
    expect(installs.map((i) => i.title)).toEqual([
      'Ascensor fuera de servicio',
      'Piscina fuera de servicio',
    ]);
    expect(installs[0]?.safety).toBe(true);
    const firstUrgent = result.items.findIndex((i) => i.urgency === 'urgente');
    expect(result.items[firstUrgent]?.safety).toBe(true);
  });

  it('cada fila apunta a la gestión que la resuelve', async () => {
    const result = await service.pendingToday(user, undefined, new Date());
    expect(result.items.every((i) => i.target.estateId === estate)).toBe(true);
    expect(new Set(result.items.map((i) => i.target.section))).toEqual(
      new Set(['cuotas', 'instalaciones', 'proveedores', 'solicitudes']),
    );
  });

  it('una finca ajena es 403; un gestor sin fincas recibe una lista vacía', async () => {
    await expect(
      service.pendingToday(user, foreignEstate, new Date()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await service.pendingToday(roleB(other, []), undefined, new Date()),
    ).toEqual({ total: 0, items: [] });
  });
});
