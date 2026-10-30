import { ForbiddenException } from '@nestjs/common';
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
import { EVENTS_HORIZON_DAYS, EVENTS_LIMIT, PropertyOverviewService } from './property-overview.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: «Próximos eventos» de una propiedad reúne
 * juntas, vencimientos de recibo, reservas propias y revisiones de
 * instalaciones, sin exponer de estas últimas nada de gestión.
 */
const prisma = createPrismaClient();
const service = new PropertyOverviewService(
  prisma as unknown as PrismaService,
  new PropertyAccessService(prisma as unknown as PrismaService, new EstateAccessService()),
);

const DAY = 86_400_000;
// 12:00 en Madrid (verano, UTC+2).
const NOW = new Date('2030-06-15T10:00:00.000Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);
const day = (n: number) => inDays(n).toISOString().slice(0, 10);
const asOwner = (id: string, estateIds: string[]) => ({ id, role: 'C', estateIds, administratorId: null }) as unknown as AuthenticatedUser;

let admin: AdministratorFixture;
let estate: string;
let otherEstate: string;
let p1: string;
let p2: string;
let p3: string;
let ownerA: string;
let ownerB: string;
let me: AuthenticatedUser;
let amenityId: string;
let otherAmenityId: string;
let assetId: string;
let otherAssetId: string;
let typeId: string;
const userIds: string[] = [];

const booking = (propertyId: string, daysFromNow: number, status: 'confirmed' | 'cancelled' | 'completed' = 'confirmed', start = '10:00', end = '12:00', amenity = amenityId) =>
  prisma.booking.create({
    data: { amenityId: amenity, propertyId, userId: ownerA, date: new Date(`${day(daysFromNow)}T00:00:00.000Z`), startSlot: start, endSlot: end, status },
  });
const meeting = (data: { title: string; at1: Date; at2: Date; status?: 'convocada' | 'celebrada'; estateId?: string; location?: string }) =>
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
      location: data.location,
      attendeeEmails: [],
      createdByUserId: ownerA,
    },
  });
const inspection = (data: { status: 'planificada' | 'citada' | 'vencida' | 'realizada'; due?: number; appointment?: number; estateId?: string; asset?: string }) =>
  prisma.regulatoryInspection.create({
    data: {
      estateId: data.estateId ?? estate,
      assetId: data.asset ?? assetId,
      inspectionTypeId: typeId,
      status: data.status,
      nextDueDate: data.due === undefined ? null : new Date(`${day(data.due)}T00:00:00.000Z`),
      appointmentDate: data.appointment === undefined ? null : new Date(`${day(data.appointment)}T00:00:00.000Z`),
      notes: 'Nota interna de gestión',
      createdByUserId: ownerA,
    },
  });
const receipt = (propertyId: string, periodKey: string, dueInDays: number, status: 'Pendiente' | 'Pagada' = 'Pendiente') =>
  issueTestReceipt(prisma as never, { estateId: estate, propertyId, periodKey, amount: '100.00', status, dueDate: inDays(dueInDays), method: 'Transferencia', includeInRemesa: false });

beforeAll(async () => {
  admin = await createAdministrator(prisma, { name: 'Gestora de prueba (eventos)' });
  estate = await createLedgerEstate(prisma, admin.administratorId, { estate: { name: 'Finca de prueba — eventos' } });
  otherEstate = await createLedgerEstate(prisma, admin.administratorId, { estate: { name: 'Otra finca — eventos' } });
  p1 = await createProperty(prisma, estate, { ref: 'E1' });
  p2 = await createProperty(prisma, estate, { ref: 'E2' });
  p3 = await createProperty(prisma, estate, { ref: 'E3' });
  ownerA = await createOwnerUser(prisma, { fullName: 'Propietaria A (eventos)' });
  ownerB = await createOwnerUser(prisma, { fullName: 'Propietario B (eventos)' });
  userIds.push(ownerA, ownerB);
  me = asOwner(ownerA, [estate]);
  for (const [propertyId, userId] of [[p1, ownerA], [p2, ownerB], [p3, ownerA]] as const) {
    await prisma.propertyMembership.create({ data: { propertyId, userId, roleType: 'Propietario', status: 'linked', linkedAt: new Date() } });
  }
  amenityId = (await prisma.amenity.create({ data: { estateId: estate, name: 'Pista de pádel', maxHours: 2, slots: ['10:00'], capacity: 4 } })).id;
  otherAmenityId = (await prisma.amenity.create({ data: { estateId: otherEstate, name: 'Piscina de otra finca', maxHours: 2, slots: ['10:00'], capacity: 4 } })).id;
  const supplier = await prisma.supplier.create({ data: { administratorId: admin.administratorId, estateId: estate, name: 'Proveedor Secreto S.L.', category: 'Ascensores' } });
  assetId = (await prisma.asset.create({ data: { estateId: estate, name: 'Ascensor A', category: 'Ascensor', supplierId: supplier.id } })).id;
  otherAssetId = (await prisma.asset.create({ data: { estateId: otherEstate, name: 'De otra finca', category: 'PCI' } })).id;
  typeId = (await prisma.inspectionType.create({ data: { estateId: estate, code: `EVT-${Date.now()}`, name: 'Revisión anual obligatoria' } })).id;
});

afterAll(async () => {
  await prisma.booking.deleteMany({ where: { amenityId: { in: [amenityId, otherAmenityId] } } });
  await prisma.amenity.deleteMany({ where: { estateId: { in: [estate, otherEstate] } } });
  await prisma.regulatoryInspection.deleteMany({ where: { estateId: { in: [estate, otherEstate] } } });
  await prisma.inspectionType.deleteMany({ where: { id: typeId } });
  await prisma.meeting.deleteMany({ where: { estateId: { in: [estate, otherEstate] } } });
  await prisma.asset.deleteMany({ where: { estateId: { in: [estate, otherEstate] } } });
  await prisma.supplier.deleteMany({ where: { estateId: estate } });
  await prisma.propertyMembership.deleteMany({ where: { propertyId: { in: [p1, p2, p3] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('PropertyOverviewService.getEvents', () => {
  it('sin nada previsto devuelve una lista vacía', async () => {
    expect(await service.getEvents(p1, me, NOW)).toEqual([]);
  });

  describe('juntas', () => {
    it('muestra la junta con su día y hora de Madrid y su lugar; ignora las celebradas, las de otras fincas y las que quedan fuera del horizonte', async () => {
      await meeting({ title: 'Junta ordinaria', at1: new Date('2030-06-25T16:00:00.000Z'), at2: new Date('2030-06-25T16:30:00.000Z'), location: 'Salón de la comunidad' });
      await meeting({ title: 'Celebrada', status: 'celebrada', at1: inDays(3), at2: inDays(4) });
      await meeting({ title: 'De otra finca', estateId: otherEstate, at1: inDays(3), at2: inDays(4) });
      await meeting({ title: 'Demasiado lejana', at1: inDays(EVENTS_HORIZON_DAYS + 10), at2: inDays(EVENTS_HORIZON_DAYS + 11) });
      const events = (await service.getEvents(p1, me, NOW)).filter((e) => e.kind === 'junta');
      expect(events).toEqual([{ id: expect.stringMatching(/^junta:/), kind: 'junta', title: 'Junta ordinaria', subtitle: 'Salón de la comunidad', date: '2030-06-25', time: '18:00' }]);
    });

    it('el horizonte es por día de Madrid también para las juntas: el último día entra y la madrugada del siguiente no', async () => {
      // Día 90 a las 21:00 UTC (23:00 en Madrid) entra; ese mismo día 90 a las 22:30 UTC ya es el 91 en Madrid (00:30) y no.
      await meeting({ title: 'Último día', at1: new Date(`${day(EVENTS_HORIZON_DAYS)}T21:00:00.000Z`), at2: new Date(`${day(EVENTS_HORIZON_DAYS)}T21:30:00.000Z`) });
      await meeting({ title: 'Día siguiente de madrugada', at1: new Date(`${day(EVENTS_HORIZON_DAYS)}T22:30:00.000Z`), at2: new Date(`${day(EVENTS_HORIZON_DAYS)}T23:00:00.000Z`) });
      const titles = (await service.getEvents(p1, me, NOW)).filter((e) => e.kind === 'junta').map((e) => e.title);
      expect(titles).toContain('Último día');
      expect(titles).not.toContain('Día siguiente de madrugada');
      await prisma.meeting.deleteMany({ where: { title: { in: ['Último día', 'Día siguiente de madrugada'] } } });
    });

    it('el día se da en hora de Madrid: una junta a las 23:30 UTC ya es del día siguiente', async () => {
      await meeting({ title: 'Casi medianoche', at1: new Date('2030-07-01T23:30:00.000Z'), at2: new Date('2030-07-02T23:30:00.000Z') });
      const e = (await service.getEvents(p1, me, NOW)).find((x) => x.title === 'Casi medianoche');
      expect(e).toMatchObject({ date: '2030-07-02', time: '01:30' });
      await prisma.meeting.deleteMany({ where: { title: 'Casi medianoche' } });
    });
  });

  describe('vencimientos de recibo', () => {
    it('incluye los recibos por pagar de ESTA propiedad que vencen dentro del horizonte; no los pagados, pasados, lejanos ni de un vecino', async () => {
      await receipt(p1, '2030-07', 20);
      await receipt(p1, '2030-05', 5, 'Pagada');
      await receipt(p1, '2030-04', -3); // ya venció
      await receipt(p1, '2030-12', EVENTS_HORIZON_DAYS + 5);
      await receipt(p2, '2030-08', 7); // del vecino
      const events = (await service.getEvents(p1, me, NOW)).filter((e) => e.kind === 'recibo');
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ title: 'Vencimiento de recibo', date: day(20), time: null });
      expect(events[0].subtitle).toContain('2030-07');
    });
  });

  describe('reservas', () => {
    it('muestra las reservas confirmadas de la propiedad con su franja; no las canceladas, las del vecino ni las de otra finca', async () => {
      await booking(p1, 3);
      await booking(p1, 4, 'cancelled');
      await booking(p2, 2); // del vecino
      await booking(p1, 2, 'confirmed', '10:00', '12:00', otherAmenityId);
      const events = (await service.getEvents(p1, me, NOW)).filter((e) => e.kind === 'reserva');
      expect(events).toEqual([{ id: expect.stringMatching(/^reserva:/), kind: 'reserva', title: 'Reserva: Pista de pádel', subtitle: '10:00 - 12:00', date: day(3), time: '10:00' }]);
    });

    it('una reserva de hoy cuenta; una de ayer no', async () => {
      await booking(p1, 0, 'confirmed', '18:00', '19:00');
      await booking(p1, -1, 'confirmed', '18:00', '19:00');
      const dates = (await service.getEvents(p1, me, NOW)).filter((e) => e.kind === 'reserva').map((e) => e.date);
      expect(dates).toContain(day(0));
      expect(dates).not.toContain(day(-1));
      await prisma.booking.deleteMany({ where: { amenityId, propertyId: p1, startSlot: '18:00' } });
    });
  });

  describe('revisiones de instalaciones (D3)', () => {
    it('muestra las planificadas y citadas de la finca con su tipo, instalación y fecha (la cita manda); no las vencidas, realizadas, lejanas ni de otra finca', async () => {
      await inspection({ status: 'planificada', due: 40 });
      await inspection({ status: 'citada', due: 200, appointment: 6 });
      await inspection({ status: 'vencida', due: -10 });
      await inspection({ status: 'realizada', due: 10 });
      await inspection({ status: 'planificada', due: EVENTS_HORIZON_DAYS + 20 });
      await inspection({ status: 'planificada', due: 8, estateId: otherEstate, asset: otherAssetId });
      const events = (await service.getEvents(p1, me, NOW)).filter((e) => e.kind === 'revision');
      expect(events.map((e) => [e.date, e.title, e.subtitle, e.time])).toEqual([
        [day(6), 'Revisión anual obligatoria', 'Ascensor A', null],
        [day(40), 'Revisión anual obligatoria', 'Ascensor A', null],
      ]);
    });

    it('no expone nada de gestión: ni proveedor, ni notas, ni identificadores de instalación', async () => {
      const json = JSON.stringify(await service.getEvents(p1, me, NOW));
      for (const secret of ['Proveedor Secreto', 'Nota interna de gestión', assetId, typeId]) expect(json).not.toContain(secret);
      // El identificador de un evento de revisión no es el de la inspección (que podría usarse en otras rutas).
      const ids = (await prisma.regulatoryInspection.findMany({ where: { estateId: estate }, select: { id: true } })).map((i) => i.id);
      for (const id of ids) expect(json).not.toContain(id);
    });
  });

  describe('orden, límite y horizonte', () => {
    it('ordena por fecha (y hora) y mezcla todos los tipos', async () => {
      const events = await service.getEvents(p1, me, NOW);
      expect(events.map((e) => e.date)).toEqual([...events.map((e) => e.date)].sort());
      expect(new Set(events.map((e) => e.kind))).toEqual(new Set(['junta', 'recibo', 'reserva', 'revision']));
    });

    it('incluye el último día del horizonte y deja fuera el siguiente', async () => {
      await booking(p3, EVENTS_HORIZON_DAYS);
      await booking(p3, EVENTS_HORIZON_DAYS + 1);
      const dates = (await service.getEvents(p3, me, NOW)).filter((e) => e.kind === 'reserva').map((e) => e.date);
      expect(dates).toEqual([day(EVENTS_HORIZON_DAYS)]);
      await prisma.booking.deleteMany({ where: { propertyId: p3 } });
    });

    it(`devuelve como máximo ${EVENTS_LIMIT} eventos: los más cercanos`, async () => {
      // Solo reservas: quita lo que la finca aporta a todas sus propiedades (juntas y revisiones).
      await prisma.meeting.deleteMany({ where: { estateId: estate } });
      await prisma.regulatoryInspection.deleteMany({ where: { estateId: estate } });
      for (let i = 1; i <= EVENTS_LIMIT + 2; i++) await booking(p3, i, 'confirmed', '09:00', '10:00');
      const events = await service.getEvents(p3, me, NOW);
      expect(events).toHaveLength(EVENTS_LIMIT);
      expect(events[0].date).toBe(day(1));
      expect(events[EVENTS_LIMIT - 1].date).toBe(day(EVENTS_LIMIT));
    });
  });

  describe('acceso', () => {
    it('un propietario no puede pedir los eventos de la propiedad de un vecino', async () => {
      await expect(service.getEvents(p2, me, NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('una propiedad sin finca (autoservicio sin vincular) no tiene eventos', async () => {
      const lone = await prisma.property.create({ data: { type: 'Piso', status: 'Ocupado', primaryUserId: ownerA, ref: 'Mi piso' } });
      expect(await service.getEvents(lone.id, me, NOW)).toEqual([]);
      await prisma.property.delete({ where: { id: lone.id } });
    });
  });
});
