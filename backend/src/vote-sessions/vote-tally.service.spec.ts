import { PrismaService } from '../prisma/prisma.service';
import { VoteTallyService } from './vote-tally.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Fase 2.1 ("motor de votación real") — el hallazgo legal más importante
 * de todo el plan: el denominador del 3/5 NO es "de los presentes" (art.
 * 17.2 LPH: "tres quintas partes DEL TOTAL de los propietarios"), a
 * diferencia de la mayoría simple (art. 17.7: "de los presentes"). Un mock
 * no atrapa este tipo de bug — solo un agregado real contra un censo real
 * lo hace. Integración contra Postgres real, mismo patrón que
 * `meeting-quorum.service.spec.ts`.
 */
const prisma = createPrismaClient();

const CIF = 'TESTGR-TALLY-1';

let administratorId: string;
let estateId: string;
let bUserId: string;
let createdByUserId: string;
// Censo de 4 propiedades: cuotas 30/25/25/20 (suman 100).
let propertyId1: string;
let propertyId2: string;
let propertyId3: string;
let propertyId4: string;
let userId1: string;
let userId2: string;

interface Fixture {
  meetingIds: string[];
}

function emptyFixture(): Fixture {
  return { meetingIds: [] };
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (fixture.meetingIds.length) {
    await prisma.voteResponse.deleteMany({ where: { voteSession: { meetingId: { in: fixture.meetingIds } } } });
    await prisma.voteSession.deleteMany({ where: { meetingId: { in: fixture.meetingIds } } });
    await prisma.meetingAttendance.deleteMany({ where: { meetingId: { in: fixture.meetingIds } } });
    await prisma.meetingState.deleteMany({ where: { meetingId: { in: fixture.meetingIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: fixture.meetingIds } } });
  }
}

async function createMeeting() {
  const now = new Date();
  return prisma.meeting.create({
    data: {
      estateId,
      title: 'Junta de prueba — tally',
      type: 'ordinaria',
      scheduledAt1: new Date(now.getTime() - 1000),
      scheduledAt2: new Date(now.getTime() + 60 * 60 * 1000),
      agenda: [{ id: 'p1', title: 'Punto único', hasVote: true, voteTemplate: { questions: [{ title: 'Aprobar', type: 'single_choice', options: ['A favor', 'En contra'] }] } }],
      convokedBy: 'presidente',
      signerRole: 'presidente',
      attendeeEmails: [],
      includeJitsi: false,
      createdByUserId,
    },
  });
}

async function openSession(meetingId: string, majorityType: 'unanimidad' | 'tresQuintos' | 'mayoriaSimple') {
  return prisma.voteSession.create({
    data: { meetingId, agendaItemId: 'p1', questionIndex: 0, majorityType, openedByUserId: bUserId },
  });
}

async function markPresent(meetingId: string, propertyId: string, userId: string) {
  await prisma.meetingAttendance.create({
    data: { meetingId, propertyId, userId, displayName: 'Test', source: 'manual' },
  });
}

async function castVote(voteSessionId: string, propertyId: string, userId: string, optionIndex: number) {
  await prisma.voteResponse.create({
    data: { voteSessionId, propertyId, userId, optionIndex },
  });
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: { name: 'Gestora de prueba (tally)', cif: CIF, plan: 'BASE', tier: 'basic', usersMax: 5, status: 'Activa' },
  });
  administratorId = admin.id;

  const estate = await prisma.estate.create({
    data: { administratorId, name: 'Finca de prueba — tally', type: 'Edificio', address: 'Calle Falsa 2021', location: 'Madrid' },
  });
  estateId = estate.id;

  const b = await prisma.user.create({
    data: { email: `admin-tally-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Gestora Admin', role: 'B', administratorId },
  });
  bUserId = b.id;
  createdByUserId = bUserId;

  const u1 = await prisma.user.create({
    data: { email: `vecino1-tally-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Vecino Uno', role: 'C' },
  });
  userId1 = u1.id;
  const u2 = await prisma.user.create({
    data: { email: `vecino2-tally-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Vecino Dos', role: 'C' },
  });
  userId2 = u2.id;

  const p1 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '1', door: 'A', quotaMonthly: '50.00', participationQuota: '30.00' },
  });
  propertyId1 = p1.id;
  const p2 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '2', door: 'A', quotaMonthly: '50.00', participationQuota: '25.00' },
  });
  propertyId2 = p2.id;
  const p3 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '3', door: 'A', quotaMonthly: '50.00', participationQuota: '25.00' },
  });
  propertyId3 = p3.id;
  const p4 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '4', door: 'A', quotaMonthly: '50.00', participationQuota: '20.00' },
  });
  propertyId4 = p4.id;
});

afterAll(async () => {
  await prisma.property.deleteMany({ where: { id: { in: [propertyId1, propertyId2, propertyId3, propertyId4] } } });
  await prisma.user.deleteMany({ where: { id: { in: [bUserId, userId1, userId2] } } });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

describe('VoteTallyService', () => {
  const service = new VoteTallyService(prisma as unknown as PrismaService);

  it('EL CASO CRÍTICO: 55% de cuota presente y a favor pasa mayoriaSimple pero NO pasa tresQuintos', async () => {
    const fx = emptyFixture();
    try {
      const meeting = await createMeeting();
      fx.meetingIds.push(meeting.id);
      const session = await openSession(meeting.id, 'tresQuintos');

      // Solo p1(30)+p2(25) están presentes (asistencia) y ambas votan a favor —
      // 55 de cuota sobre un censo total de 100 (p1+p2+p3+p4), 50% de propietarios (2/4).
      await markPresent(meeting.id, propertyId1, userId1);
      await markPresent(meeting.id, propertyId2, userId2);
      await castVote(session.id, propertyId1, userId1, 0);
      await castVote(session.id, propertyId2, userId2, 0);

      const asTresQuintos = await service.tally(meeting.id, session.id, 'tresQuintos', 'single_choice');
      expect(asTresQuintos.denominatorBasis).toBe('censo');
      expect(asTresQuintos.quotaDenominatorTotal).toBe(100);
      expect(asTresQuintos.quotaFavorablePct).toBe(55);
      expect(asTresQuintos.ownersFavorablePct).toBe(50);
      expect(asTresQuintos.passed).toBe(false); // 55% < 60% del censo total, y 50% < 60% de propietarios

      // Exactamente los mismos votos y la misma asistencia — solo cambia el
      // tipo de mayoría consultado — SÍ pasan mayoría simple: el denominador
      // pasa a ser "los presentes" (p1+p2 = 55 de cuota, 2 propiedades), y
      // ambos son favorables → 100% de los presentes.
      const asMayoriaSimple = await service.tally(meeting.id, session.id, 'mayoriaSimple', 'single_choice');
      expect(asMayoriaSimple.denominatorBasis).toBe('presentes');
      expect(asMayoriaSimple.quotaDenominatorTotal).toBe(55);
      expect(asMayoriaSimple.quotaFavorablePct).toBe(100);
      expect(asMayoriaSimple.ownersFavorablePct).toBe(100);
      expect(asMayoriaSimple.passed).toBe(true);
    } finally {
      await cleanup(fx);
    }
  });

  it('unanimidad exige el 100% del censo — una sola propiedad en contra la tumba aunque el resto vote a favor', async () => {
    const fx = emptyFixture();
    try {
      const meeting = await createMeeting();
      fx.meetingIds.push(meeting.id);
      const session = await openSession(meeting.id, 'unanimidad');

      await castVote(session.id, propertyId1, userId1, 0); // a favor
      await castVote(session.id, propertyId2, userId2, 1); // en contra

      const result = await service.tally(meeting.id, session.id, 'unanimidad', 'single_choice');
      expect(result.denominatorBasis).toBe('censo');
      expect(result.ownersFavorablePct).toBeLessThan(100);
      expect(result.passed).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });

  it('multiple_choice nunca calcula veredicto de aprobado/rechazado, solo recuento por opción', async () => {
    const fx = emptyFixture();
    try {
      const meeting = await createMeeting();
      fx.meetingIds.push(meeting.id);
      const session = await openSession(meeting.id, 'mayoriaSimple');
      await markPresent(meeting.id, propertyId1, userId1);
      await prisma.voteResponse.create({
        data: { voteSessionId: session.id, propertyId: propertyId1, userId: userId1, optionIndexes: [0, 2] },
      });

      const result = await service.tally(meeting.id, session.id, 'mayoriaSimple', 'multiple_choice');
      expect(result.passed).toBeNull();
      expect(result.optionTally).toEqual([
        { optionIndex: 0, propertyCount: 1 },
        { optionIndex: 2, propertyCount: 1 },
      ]);
    } finally {
      await cleanup(fx);
    }
  });
});
