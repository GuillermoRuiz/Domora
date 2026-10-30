import { ForbiddenException } from '@nestjs/common';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { buildChange, ManagerKpisService } from './manager-kpis.service';
import { shiftMonths } from './manager-scope';
import { createPrismaClient } from '../prisma/create-prisma-client';

describe('buildChange / shiftMonths', () => {
  it('previo 0 con valor => «nuevo»; ambos 0 => 0 %; en otro caso, porcentaje con un decimal', () => {
    expect(buildChange(3, 0)).toEqual({ type: 'new' });
    expect(buildChange(0, 0)).toEqual({ type: 'percent', value: 0 });
    expect(buildChange(15, 10)).toEqual({ type: 'percent', value: 50 });
    expect(buildChange(1, 3)).toEqual({ type: 'percent', value: -66.7 });
    expect(buildChange(0, 4)).toEqual({ type: 'percent', value: -100 });
  });

  it('shiftMonths recorta el día a fin de mes y cruza de año', () => {
    expect(shiftMonths(new Date('2026-08-31T00:00:00Z'), -6).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(shiftMonths(new Date('2026-02-10T00:00:00Z'), -6).toISOString().slice(0, 10)).toBe('2025-08-10');
    expect(shiftMonths(new Date('2026-10-18T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2027-04-18');
  });
});

/**
 * Integración contra Postgres real: lo que importa es reconstruir el valor de hace
 * 6 meses con las mismas reglas que el actual, y que una gestora solo vea lo suyo.
 */
const prisma = createPrismaClient();
const access = new EstateAccessService();
const service = new ManagerKpisService(prisma as unknown as PrismaService, access, new LedgerQueryService(prisma as unknown as PrismaService));

const DAY = 86_400_000;
const now = new Date();
const ago = (days: number) => new Date(now.getTime() - days * DAY);
const periodOf = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

let admin: AdministratorFixture;
let other: AdministratorFixture;
let oldEstate: string;
let newEstate: string;
let foreignEstate: string;
let p1: string;
let user: AuthenticatedUser;
let seq = 0;

function issue(estateId: string, status: 'Abierta' | 'EnReparacion' | 'Resuelta', date: Date, opts: { deleted?: boolean } = {}) {
  seq += 1;
  return prisma.issue.create({
    data: {
      ref: `KPI-${Date.now()}-${seq}`, estateId, type: 'Fuga', title: 'Incidencia de prueba', description: 'x',
      status, priority: 'Normal', source: 'Comunidad', date, deletedAt: opts.deleted ? new Date() : null,
    },
  });
}

function meeting(estateId: string, status: 'convocada' | 'celebrada' | 'cancelada', at: Date) {
  return prisma.meeting.create({
    data: {
      estateId, title: 'Junta de prueba', type: 'ordinaria', status, scheduledAt1: at,
      scheduledAt2: new Date(at.getTime() + 30 * 60_000), agenda: [], convokedBy: 'presidente', signerRole: 'administrador',
      createdByUserId: admin.userId,
    },
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, { name: 'Gestora de prueba (kpis)' });
  other = await createAdministrator(prisma, { name: 'Otra gestora (kpis)' });
  // Una finca de hace un año y otra recién creada.
  oldEstate = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2000, 0, 1)),
    estate: { name: 'Finca antigua — kpis', createdAt: ago(365) },
  });
  newEstate = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2000, 0, 1)),
    estate: { name: 'Finca nueva — kpis' },
  });
  foreignEstate = await createLedgerEstate(prisma, other.administratorId, {
    cutoverDate: new Date(Date.UTC(2000, 0, 1)),
    estate: { name: 'Finca ajena — kpis', createdAt: ago(365) },
  });
  user = roleB(admin, [oldEstate, newEstate]);
  p1 = await createProperty(prisma, oldEstate);

  // Incidencias de la finca antigua.
  await issue(oldEstate, 'Abierta', ago(240)); // activa antes y ahora
  const resolved = await issue(oldEstate, 'Resuelta', ago(240)); // activa hace 6 meses, resuelta hace 3
  await prisma.issueTimelineEntry.create({
    data: { issueId: resolved.id, date: ago(90), role: 'Administrador', text: 'Resuelta', fromStatus: 'Abierta', toStatus: 'Resuelta' },
  });
  await issue(oldEstate, 'EnReparacion', ago(10)); // solo ahora
  await issue(oldEstate, 'Abierta', ago(240), { deleted: true }); // borrada hoy: ya no cuenta ahora, sí hace 6 meses
  await issue(foreignEstate, 'Abierta', ago(5)); // de otra gestora: no cuenta

  // Cuotas: una de hace 8 meses (antes y ahora) y una de hace 2 meses (solo ahora).
  await issueTestReceipt(prisma, { estateId: oldEstate, propertyId: p1, periodKey: periodOf(ago(240)), amount: '100.00', status: 'Pendiente' });
  await issueTestReceipt(prisma, { estateId: oldEstate, propertyId: p1, periodKey: periodOf(ago(60)), amount: '50.00', status: 'Pendiente' });

  // Solicitudes: una pendiente reciente, otra pendiente hace 8 meses y resuelta hace 1 mes, y una de otra gestora.
  const requester = await createOwnerUser(prisma);
  await prisma.adhesionRequest.create({ data: { estateId: oldEstate, userId: requester, roleType: 'Propietario', submittedAt: ago(60), status: 'pending' } });
  await prisma.adhesionRequest.create({
    data: { estateId: oldEstate, userId: requester, roleType: 'Propietario', submittedAt: ago(240), status: 'approved', resolvedAt: ago(30), decision: 'approved' },
  });
  await prisma.adhesionRequest.create({ data: { estateId: foreignEstate, userId: requester, roleType: 'Propietario', submittedAt: ago(2), status: 'pending' } });

  // Juntas: 2 convocadas en los próximos 6 meses, 1 a +8 meses, 1 celebrada hace 2 meses, 1 hace 8 meses, 1 cancelada.
  await meeting(oldEstate, 'convocada', new Date(now.getTime() + 30 * DAY));
  await meeting(newEstate, 'convocada', new Date(now.getTime() + 150 * DAY));
  await meeting(oldEstate, 'convocada', new Date(now.getTime() + 240 * DAY));
  await meeting(oldEstate, 'celebrada', ago(60));
  await meeting(oldEstate, 'celebrada', ago(240));
  await meeting(oldEstate, 'cancelada', new Date(now.getTime() + 20 * DAY));
});

afterAll(async () => {
  const estateIds = [oldEstate, newEstate, foreignEstate];
  await prisma.issue.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.adhesionRequest.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.meeting.deleteMany({ where: { estateId: { in: estateIds } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, other.administratorId);
  await prisma.$disconnect();
});

describe('ManagerKpisService.kpis', () => {
  it('vista global: solo las fincas del gestor, con su valor de ahora y el de hace 6 meses', async () => {
    const kpis = await service.kpis(user, undefined, new Date());
    expect(kpis.estateId).toBeNull();
    expect(kpis.estates).toMatchObject({ value: 2, previous: 1, change: { type: 'percent', value: 100 } });
    // Hace 6 meses: la abierta, la que luego se resolvió y la que se borró después (existía entonces).
    expect(kpis.activeIssues).toMatchObject({ value: 2, previous: 3, change: { type: 'percent', value: -33.3 } });
    expect(kpis.pendingDues).toMatchObject({ value: 150, previous: 100, change: { type: 'percent', value: 50 } });
    expect(kpis.pendingRequests).toMatchObject({ value: 1, previous: 1 });
    expect(kpis.upcomingMeetings).toMatchObject({ value: 2, previous: 1, change: { type: 'percent', value: 100 } });
  });

  it('con una finca elegida solo cuenta esa', async () => {
    const kpis = await service.kpis(user, newEstate, new Date());
    expect(kpis.estateId).toBe(newEstate);
    expect(kpis.estates).toMatchObject({ value: 1, previous: 0, change: { type: 'new' } });
    expect(kpis.activeIssues.value).toBe(0);
    expect(kpis.pendingDues.value).toBe(0);
    expect(kpis.upcomingMeetings).toMatchObject({ value: 1, previous: 0, change: { type: 'new' } });
  });

  it('una finca ajena es 403 y no se filtra ningún dato', async () => {
    await expect(service.kpis(user, foreignEstate, new Date())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un gestor sin fincas recibe todo a 0', async () => {
    const empty = roleB(other, []);
    const kpis = await service.kpis(empty, undefined, new Date());
    expect([kpis.estates.value, kpis.activeIssues.value, kpis.pendingDues.value, kpis.pendingRequests.value, kpis.upcomingMeetings.value]).toEqual([0, 0, 0, 0, 0]);
  });
});
