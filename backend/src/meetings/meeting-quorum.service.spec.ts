import { PrismaService } from '../prisma/prisma.service';
import { MeetingQuorumService } from './meeting-quorum.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Fase 1 ("Quórum real en juntas") — el quórum de art. 16 LPH exige una
 * doble mayoría simultánea (propietarios Y cuotas) en 1ª convocatoria, y
 * ninguna en 2ª. Requiere cruzar el censo real de la finca
 * (`Property.participationQuota`) con la asistencia por propiedad — es
 * exactamente el tipo de agregado multi-fila que un mock no verifica de
 * verdad. Integración contra Postgres real, mismo patrón que
 * `resources/communication-threads-targeting.spec.ts`.
 */
const prisma = createPrismaClient();

const CIF = 'TESTGR-QUORUM-1';

let administratorId: string;
let estateId: string;
let bUserId: string;
let createdByUserId: string;
// Censo de 4 propiedades: cuotas 40/30/20/10 (suman 100). p1/p2 presentes =
// 70% cuotas (>50%) y 2/4 propietarios (50%, NO estrictamente >50%) — a
// propósito, para poder probar el caso "cuotas sí, propietarios no".
let propertyId1: string;
let propertyId2: string;
let propertyId3: string;
let propertyId4: string;
let userId1: string;
let userId2: string;
let userId3: string;

interface Fixture {
  meetingIds: string[];
}

function emptyFixture(): Fixture {
  return { meetingIds: [] };
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (fixture.meetingIds.length) {
    await prisma.meetingAttendance.deleteMany({ where: { meetingId: { in: fixture.meetingIds } } });
    await prisma.meetingState.deleteMany({ where: { meetingId: { in: fixture.meetingIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: fixture.meetingIds } } });
  }
}

async function createMeeting(scheduledAt1: Date, scheduledAt2: Date) {
  return prisma.meeting.create({
    data: {
      estateId,
      title: 'Junta de prueba — quórum',
      type: 'ordinaria',
      scheduledAt1,
      scheduledAt2,
      agenda: [{ id: 'p1', title: 'Punto único' }],
      convokedBy: 'presidente',
      signerRole: 'presidente',
      attendeeEmails: [],
      includeJitsi: false,
      createdByUserId,
    },
  });
}

async function markPresent(meetingId: string, propertyId: string, userId: string) {
  await prisma.meetingAttendance.create({
    data: { meetingId, propertyId, userId, displayName: 'Test', source: 'manual' },
  });
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: { name: 'Gestora de prueba (quórum)', cif: CIF, plan: 'BASE', tier: 'basic', usersMax: 5, status: 'Activa' },
  });
  administratorId = admin.id;

  const estate = await prisma.estate.create({
    data: { administratorId, name: 'Finca de prueba — quórum', type: 'Edificio', address: 'Calle Falsa 2020', location: 'Madrid' },
  });
  estateId = estate.id;

  const b = await prisma.user.create({
    data: { email: `admin-quorum-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Gestora Admin', role: 'B', administratorId },
  });
  bUserId = b.id;
  createdByUserId = bUserId;

  const u1 = await prisma.user.create({
    data: { email: `vecino1-quorum-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Vecino Uno', role: 'C' },
  });
  userId1 = u1.id;
  const u2 = await prisma.user.create({
    data: { email: `vecino2-quorum-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Vecino Dos', role: 'C' },
  });
  userId2 = u2.id;
  const u3 = await prisma.user.create({
    data: { email: `vecino3-quorum-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Vecino Tres', role: 'C' },
  });
  userId3 = u3.id;

  const p1 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '1', door: 'A', quotaMonthly: '50.00', participationQuota: '40.00' },
  });
  propertyId1 = p1.id;
  const p2 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '2', door: 'A', quotaMonthly: '50.00', participationQuota: '30.00' },
  });
  propertyId2 = p2.id;
  const p3 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '3', door: 'A', quotaMonthly: '50.00', participationQuota: '20.00' },
  });
  propertyId3 = p3.id;
  // p4 SIN coeficiente — debe excluirse del % de cuotas pero contarse en missingParticipationQuotaCount.
  const p4 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '4', door: 'A', quotaMonthly: '50.00' },
  });
  propertyId4 = p4.id;
});

afterAll(async () => {
  await prisma.property.deleteMany({ where: { id: { in: [propertyId1, propertyId2, propertyId3, propertyId4] } } });
  await prisma.user.deleteMany({ where: { id: { in: [bUserId, userId1, userId2, userId3] } } });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

describe('MeetingQuorumService', () => {
  const service = new MeetingQuorumService(prisma as unknown as PrismaService);

  it('1ª convocatoria: mayoría de cuotas Y de propietarios simultánea da quórum', async () => {
    const fx = emptyFixture();
    try {
      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const meeting = await createMeeting(new Date(now.getTime() - 1000), future);
      fx.meetingIds.push(meeting.id);
      // p1(40) + p2(30) + p3(20) presentes, 3/4 = 75% propietarios. p4 (sin
      // coeficiente) se excluye del denominador de cuotas igual que del
      // numerador — census de cuotas conocido = 90, presente = 90 → 100%.
      await markPresent(meeting.id, propertyId1, userId1);
      await markPresent(meeting.id, propertyId2, userId2);
      await markPresent(meeting.id, propertyId3, userId3);

      const result = await service.computeQuorum(meeting.id, now);

      expect(result.convocatoria).toBe('primera');
      expect(result.quorumRequired).toBe(true);
      expect(result.owners.percent).toBe(75);
      expect(result.quota.percent).toBe(100);
      expect(result.quorumMet).toBe(true);
      expect(result.missingParticipationQuotaCount).toBe(1); // p4 sin coeficiente
    } finally {
      await cleanup(fx);
    }
  });

  it('1ª convocatoria: mayoría de cuotas pero SIN mayoría estricta de propietarios no da quórum', async () => {
    const fx = emptyFixture();
    try {
      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const meeting = await createMeeting(new Date(now.getTime() - 1000), future);
      fx.meetingIds.push(meeting.id);
      // p1(40) + p2(30) = 70 de cuota presente sobre un census conocido de
      // 90 (p4 excluida) = 77.78% (>50%), pero 2/4 = 50% propietarios (NO
      // estrictamente >50%).
      await markPresent(meeting.id, propertyId1, userId1);
      await markPresent(meeting.id, propertyId2, userId2);

      const result = await service.computeQuorum(meeting.id, now);

      expect(result.quota.percent).toBe(77.78);
      expect(result.owners.percent).toBe(50);
      expect(result.quorumMet).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });

  it('2ª convocatoria: nunca exige quórum, aunque no haya nadie presente', async () => {
    const fx = emptyFixture();
    try {
      const past1 = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const past2 = new Date(Date.now() - 60 * 60 * 1000);
      const meeting = await createMeeting(past1, past2);
      fx.meetingIds.push(meeting.id);

      const result = await service.computeQuorum(meeting.id, new Date());

      expect(result.convocatoria).toBe('segunda');
      expect(result.quorumRequired).toBe(false);
      expect(result.quorumMet).toBe(true);
      expect(result.owners.present).toBe(0);
    } finally {
      await cleanup(fx);
    }
  });

  it('varios cotitulares de la misma propiedad cuentan como UNA sola propiedad presente', async () => {
    const fx = emptyFixture();
    try {
      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const meeting = await createMeeting(new Date(now.getTime() - 1000), future);
      fx.meetingIds.push(meeting.id);
      await markPresent(meeting.id, propertyId1, userId1);
      await markPresent(meeting.id, propertyId1, userId2); // segundo cotitular de la MISMA propiedad

      const result = await service.computeQuorum(meeting.id, now);

      expect(result.owners.present).toBe(1);
      expect(result.attendingProperties).toHaveLength(1);
      expect(result.attendingProperties[0].attendeeNames).toHaveLength(2);
    } finally {
      await cleanup(fx);
    }
  });

  it('una propiedad con delegación vigente cuenta como presente aunque el representante sea externo', async () => {
    const fx = emptyFixture();
    try {
      const now = new Date();
      const future = new Date(now.getTime() + 60 * 60 * 1000);
      const meeting = await createMeeting(new Date(now.getTime() - 1000), future);
      fx.meetingIds.push(meeting.id);
      await markPresent(meeting.id, propertyId1, userId1);
      const base = { meetingId: meeting.id, delegatorUserId: userId2, createdByUserId };
      await prisma.meetingVoteDelegation.create({
        data: { ...base, propertyId: propertyId2, representativeName: 'Marta Gil', representativeDni: '12345678Z' },
      });
      await prisma.meetingVoteDelegation.create({
        data: {
          ...base,
          propertyId: propertyId3,
          representativeName: 'Pedro Sanz',
          representativeDni: '12345678Z',
          revokedAt: new Date(),
        },
      });

      const result = await service.computeQuorum(meeting.id, now);

      expect(result.owners.present).toBe(2); // p1 asiste, p2 representada; p3 revocada no cuenta
      expect(result.quota.present).toBe(70);
      expect(result.attendingProperties.find((p) => p.propertyId === propertyId2)?.attendeeNames).toEqual([
        'Marta Gil (representante)',
      ]);
    } finally {
      await cleanup(fx);
    }
  });
});
