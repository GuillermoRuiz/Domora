import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { PropertyOverviewService } from './property-overview.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: las fichas de «Mi comunidad» se calculan
 * para UNA propiedad y solo con lo que su propietario puede ver.
 */
const prisma = createPrismaClient();
const service = new PropertyOverviewService(
  prisma as unknown as PrismaService,
  new PropertyAccessService(prisma as unknown as PrismaService, new EstateAccessService()),
);

const DAY = 86_400_000;
const NOW = new Date('2030-06-15T10:00:00.000Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);
const asOwner = (id: string, estateIds: string[]) => ({ id, role: 'C', estateIds, administratorId: null }) as unknown as AuthenticatedUser;

let admin: AdministratorFixture;
let estate: string;
let otherEstate: string;
let p1: string; // propiedad de ownerA
let p2: string; // propiedad de ownerB (vecino)
let ownerA: string;
let ownerB: string;
let me: AuthenticatedUser;
const userIds: string[] = [];
let issueSeq = 0;

const issue = (estateId: string, status: 'Abierta' | 'Resuelta', createdDaysAgo = 0, deletedAt: Date | null = null) =>
  prisma.issue.create({
    data: {
      ref: `OVP-${Date.now()}-${++issueSeq}`,
      estateId,
      type: 'Fuga',
      title: 'Incidencia',
      description: 'x',
      status,
      priority: 'Normal',
      source: 'Propietario',
      date: NOW,
      createdAt: inDays(-createdDaysAgo),
      deletedAt,
    },
  });
const meeting = (data: { estateId?: string; status?: 'convocada' | 'celebrada'; at1: Date; at2: Date; title: string }) =>
  prisma.meeting.create({
    data: {
      estateId: data.estateId ?? estate,
      title: data.title,
      type: 'ordinaria',
      status: data.status ?? 'convocada',
      scheduledAt1: data.at1,
      scheduledAt2: data.at2,
      agenda: [],
      convokedBy: 'presidente',
      signerRole: 'presidente',
      attendeeEmails: [],
      createdByUserId: ownerA,
    },
  });
/** General documents are published to the owners; targeted ones are «Una propiedad» (library visibility). */
const document = (data: { title: string; daysAgo: number; targetPropertyId?: string | null; estateId?: string; managerOnly?: boolean }) =>
  prisma.document.create({
    data: {
      estateId: data.estateId ?? estate, title: data.title, type: 'Otro', date: inDays(-data.daysAgo), size: '1 MB', targetPropertyId: data.targetPropertyId ?? null,
      ...(data.targetPropertyId ? { visibility: 'PROPERTY', effectiveVisibility: 'PROPERTY' } : { effectiveVisibility: data.managerOnly ? 'MANAGER' : 'OWNERS' }),
    } as never,
  });
const receipt = (propertyId: string, periodKey: string, dueInDays: number, status: 'Pendiente' | 'Pagada' | 'Devuelto' = 'Pendiente', amount = '100.00') =>
  issueTestReceipt(prisma as never, { estateId: estate, propertyId, periodKey, amount, status, dueDate: inDays(dueInDays), method: 'Transferencia', includeInRemesa: false });

beforeAll(async () => {
  admin = await createAdministrator(prisma, { name: 'Gestora de prueba (fichas propietario)' });
  estate = await createLedgerEstate(prisma, admin.administratorId, { estate: { name: 'Finca de prueba — fichas' } });
  otherEstate = await createLedgerEstate(prisma, admin.administratorId, { estate: { name: 'Otra finca — fichas' } });
  p1 = await createProperty(prisma, estate, { ref: 'F1' });
  p2 = await createProperty(prisma, estate, { ref: 'F2' });
  ownerA = await createOwnerUser(prisma, { fullName: 'Propietaria A (fichas)' });
  ownerB = await createOwnerUser(prisma, { fullName: 'Propietario B (fichas)' });
  userIds.push(ownerA, ownerB);
  me = asOwner(ownerA, [estate]);
  for (const [propertyId, userId] of [[p1, ownerA], [p2, ownerB]] as const) {
    await prisma.propertyMembership.create({ data: { propertyId, userId, roleType: 'Propietario', status: 'linked', linkedAt: new Date() } });
  }
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { estateId: { in: [estate, otherEstate] } } });
  await prisma.meeting.deleteMany({ where: { estateId: { in: [estate, otherEstate] } } });
  await prisma.issue.deleteMany({ where: { estateId: { in: [estate, otherEstate] } } });
  await prisma.propertyMembership.deleteMany({ where: { propertyId: { in: [p1, p2] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('PropertyOverviewService.getOverview', () => {
  describe('próximo recibo', () => {
    it('sin recibos por pagar es null', async () => {
      expect((await service.getOverview(p1, me, NOW)).nextReceipt).toBeNull();
    });

    it('es el recibo por pagar que vence antes; los pagados no cuentan y los de un vecino tampoco', async () => {
      await receipt(p1, '2030-07', 20, 'Pendiente', '125.00');
      await receipt(p1, '2030-08', 5, 'Pendiente', '90.00');
      await receipt(p1, '2030-05', 1, 'Pagada', '80.00'); // vence antes, pero ya está pagado
      await receipt(p2, '2030-06', 2, 'Pendiente', '70.00'); // del vecino, vence antes
      const { nextReceipt } = await service.getOverview(p1, me, NOW);
      expect(nextReceipt).toMatchObject({ amount: 90, status: 'Pendiente' });
      expect(nextReceipt?.concept).toContain('2030-08');
      expect(nextReceipt?.dueDate?.toISOString().slice(0, 10)).toBe(inDays(5).toISOString().slice(0, 10));
    });

    it('un recibo devuelto vuelve a estar por pagar', async () => {
      await receipt(p1, '2030-09', 2, 'Devuelto', '60.00');
      expect((await service.getOverview(p1, me, NOW)).nextReceipt).toMatchObject({ amount: 60, status: 'Devuelto' });
    });
  });

  describe('solicitudes', () => {
    it('cuenta las incidencias activas de la COMUNIDAD, las abiertas en los últimos 30 días y en los 30 anteriores, sin las borradas ni las de otra finca', async () => {
      await issue(estate, 'Abierta', 2);
      await issue(estate, 'Abierta', 40); // activa pero antigua: cuenta en los 30 días anteriores
      await issue(estate, 'Resuelta', 70); // fuera de las dos ventanas
      await issue(estate, 'Resuelta', 10); // reciente, ya resuelta
      await issue(estate, 'Abierta', 1, new Date()); // borrada
      await issue(estate, 'Abierta', 1); // de otro vecino: también es de la comunidad
      await issue(otherEstate, 'Abierta', 1); // de otra finca
      expect((await service.getOverview(p1, me, NOW)).requests).toEqual({ open: 3, newLast30Days: 3, newPrevious30Days: 1 });
    });

    it('todos los vecinos de la comunidad ven las mismas cifras (las incidencias no son de una vivienda)', async () => {
      expect((await service.getOverview(p2, asOwner(ownerB, [estate]), NOW)).requests).toEqual({ open: 3, newLast30Days: 3, newPrevious30Days: 1 });
    });
  });

  describe('próxima junta', () => {
    it('es null si no hay ninguna convocada', async () => {
      expect((await service.getOverview(p1, me, NOW)).nextMeeting).toBeNull();
    });

    it('es la convocada más cercana de la finca; ignora las pasadas, las celebradas y las de otras fincas', async () => {
      await meeting({ title: 'Lejana', at1: inDays(30), at2: inDays(31) });
      await meeting({ title: 'Próxima', at1: inDays(10), at2: inDays(11) });
      await meeting({ title: 'Ya pasó', at1: inDays(-3), at2: inDays(-2) });
      await meeting({ title: 'Celebrada', status: 'celebrada', at1: inDays(2), at2: inDays(3) });
      await meeting({ title: 'De otra finca', estateId: otherEstate, at1: inDays(1), at2: inDays(2) });
      const { nextMeeting } = await service.getOverview(p1, me, NOW);
      expect(nextMeeting?.title).toBe('Próxima');
      expect(nextMeeting?.scheduledAt.toISOString()).toBe(inDays(10).toISOString());
    });

    it('si la primera convocatoria ya pasó pero la segunda no, muestra la segunda', async () => {
      await meeting({ title: 'Segunda convocatoria', at1: inDays(-0.1), at2: inDays(0.4) });
      const { nextMeeting } = await service.getOverview(p1, me, NOW);
      expect(nextMeeting?.title).toBe('Segunda convocatoria');
      expect(nextMeeting?.scheduledAt.toISOString()).toBe(inDays(0.4).toISOString());
    });

    it('con varias convocadas gana la de fecha efectiva más cercana, no la de primera convocatoria más temprana', async () => {
      // Tiene la primera convocatoria más temprana, pero ya pasó y su segunda es la más lejana.
      await meeting({ title: 'Primera pasada, segunda lejana', at1: inDays(-0.2), at2: inDays(5) });
      await meeting({ title: 'Primera en 2 días', at1: inDays(2), at2: inDays(3) });
      const { nextMeeting } = await service.getOverview(p1, me, NOW);
      expect(nextMeeting?.title).toBe('Segunda convocatoria'); // la de +0.4 días del test anterior sigue siendo la más cercana
      await prisma.meeting.deleteMany({ where: { title: 'Segunda convocatoria' } });
      expect((await service.getOverview(p1, me, NOW)).nextMeeting?.title).toBe('Primera en 2 días');
    });
  });

  describe('documentos nuevos', () => {
    it('cuenta los del último mes que puede ver: los generales y los dirigidos a ESTA propiedad', async () => {
      await document({ title: 'General reciente', daysAgo: 3 });
      await document({ title: 'Para mí', daysAgo: 5, targetPropertyId: p1 });
      await document({ title: 'Para el vecino', daysAgo: 5, targetPropertyId: p2 });
      await document({ title: 'General antiguo', daysAgo: 45 });
      await document({ title: 'De otra finca', daysAgo: 1, estateId: otherEstate });
      await document({ title: 'Solo para la gestora', daysAgo: 2, managerOnly: true });
      expect((await service.getOverview(p1, me, NOW)).documents).toEqual({ newLast30Days: 2 });
      expect((await service.getOverview(p2, asOwner(ownerB, [estate]), NOW)).documents).toEqual({ newLast30Days: 2 });
    });
  });

  describe('acceso', () => {
    it('devuelve el identificador de la propiedad y de su finca', async () => {
      expect(await service.getOverview(p1, me, NOW)).toMatchObject({ propertyId: p1, estateId: estate });
    });

    it('un propietario no puede pedir las fichas de la propiedad de un vecino de su misma finca', async () => {
      await expect(service.getOverview(p2, me, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('una propiedad que no existe, o está borrada, da 404', async () => {
      await expect(service.getOverview('00000000-0000-4000-8000-000000000000', me, NOW)).rejects.toBeInstanceOf(NotFoundException);
      const gone = await createProperty(prisma, estate, { ref: 'F9' });
      await prisma.property.update({ where: { id: gone }, data: { deletedAt: new Date() } });
      await expect(service.getOverview(gone, me, NOW)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('una propiedad sin finca (alta de autoservicio aún sin vincular) devuelve fichas vacías', async () => {
      const lone = await prisma.property.create({ data: { type: 'Piso', status: 'Ocupado', primaryUserId: ownerA, ref: 'Mi piso' } });
      const out = await service.getOverview(lone.id, me, NOW);
      expect(out).toMatchObject({ estateId: null, nextReceipt: null, nextMeeting: null, documents: { newLast30Days: 0 }, requests: { open: 0, newLast30Days: 0 } });
      await prisma.property.delete({ where: { id: lone.id } });
    });
  });
});

describe('PropertyOverviewService.getOverviewForUser (todas mis propiedades)', () => {
  let p3: string; // ownerA en la otra finca
  let p4: string; // segunda propiedad de ownerA en la misma finca que p1
  let all: AuthenticatedUser;

  beforeAll(async () => {
    p3 = await createProperty(prisma, otherEstate, { ref: 'O1' });
    p4 = await createProperty(prisma, estate, { ref: 'F4' });
    for (const propertyId of [p3, p4]) {
      await prisma.propertyMembership.create({ data: { propertyId, userId: ownerA, roleType: 'Propietario', status: 'linked', linkedAt: new Date() } });
    }
    all = asOwner(ownerA, [estate, otherEstate]);
  });

  afterAll(async () => {
    await prisma.propertyMembership.deleteMany({ where: { propertyId: { in: [p3, p4] } } });
  });

  it('agrega las propiedades accesibles del propietario sin contar dos veces lo de una misma finca', async () => {
    await issueTestReceipt(prisma as never, { estateId: otherEstate, propertyId: p3, periodKey: '2030-06', amount: '40.00', status: 'Pendiente', dueDate: inDays(1), method: 'Transferencia', includeInRemesa: false });
    await issue(otherEstate, 'Abierta', 3);
    const out = await service.getOverviewForUser(all, NOW);

    expect(out).toMatchObject({ propertyId: null, estateId: null });
    // El recibo por pagar que vence antes entre todas, con la propiedad a la que pertenece.
    expect(out.nextReceipt).toMatchObject({ amount: 40, status: 'Pendiente', propertyId: p3 });
    // Las incidencias son de la comunidad: la finca de p1 y p4 (3 activas, 3 nuevas, 1 del mes anterior) y la de p3 (2 activas y nuevas).
    expect(out.requests).toEqual({ open: 5, newLast30Days: 5, newPrevious30Days: 1 });
    // La junta de la otra finca (mañana) es la más cercana de todas sus fincas.
    expect(out.nextMeeting).toMatchObject({ title: 'De otra finca', estateId: otherEstate });
    // «General reciente» y «Para mí» de la finca de p1 y p4 (una vez cada uno) + «De otra finca».
    expect(out.documents).toEqual({ newLast30Days: 3 });
  });

  it('no incluye la propiedad de un vecino ni las de membresías revocadas', async () => {
    await prisma.propertyMembership.updateMany({ where: { propertyId: p3, userId: ownerA }, data: { revokedAt: new Date() } });
    const out = await service.getOverviewForUser(all, NOW);
    expect(out.nextReceipt?.propertyId).not.toBe(p3);
    // Sin p3 ya no es miembro de la otra finca: solo cuentan las incidencias de la suya.
    expect(out.requests).toEqual({ open: 3, newLast30Days: 3, newPrevious30Days: 1 });
    await prisma.propertyMembership.updateMany({ where: { propertyId: p3, userId: ownerA }, data: { revokedAt: null } });
  });

  it('no incluye membresías pendientes ni propiedades borradas', async () => {
    await prisma.propertyMembership.updateMany({ where: { propertyId: p3, userId: ownerA }, data: { status: 'pending' } });
    expect((await service.getOverviewForUser(all, NOW)).requests.open).toBe(3);
    await prisma.propertyMembership.updateMany({ where: { propertyId: p3, userId: ownerA }, data: { status: 'linked' } });
    await prisma.property.update({ where: { id: p3 }, data: { deletedAt: new Date() } });
    expect((await service.getOverviewForUser(all, NOW)).requests.open).toBe(3);
    await prisma.property.update({ where: { id: p3 }, data: { deletedAt: null } });
    expect((await service.getOverviewForUser(all, NOW)).requests.open).toBe(5);
  });

  it('sin ninguna propiedad devuelve fichas vacías', async () => {
    const out = await service.getOverviewForUser(asOwner('00000000-0000-4000-8000-000000000001', []), NOW);
    expect(out).toEqual({
      propertyId: null, estateId: null, nextReceipt: null, nextMeeting: null,
      requests: { open: 0, newLast30Days: 0, newPrevious30Days: 0 }, documents: { newLast30Days: 0 },
    });
  });
});
