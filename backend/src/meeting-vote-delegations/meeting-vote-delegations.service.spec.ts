import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { MeetingVoteDelegationsService } from './meeting-vote-delegations.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Fase 1 ("Quórum real en juntas") — delegación de voto art. 15.1 LPH: un
 * escrito firmado simple, sin notario, atado a una junta y una propiedad
 * concretas. Deliberadamente separada de `UserRepresentation` (representación
 * legal pesada). Integración contra Postgres real — auto-revocación al
 * sustituir, autorización por rol y resolución por email son justo el tipo
 * de lógica cruzada entre filas que un mock no prueba de verdad.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();

const CIF = 'TESTGR-DELEG-1';

let administratorId: string;
let estateId: string;
let bUserId: string;
let ownerUserId: string; // titular de propertyId1, puede delegar
let tenantUserId: string; // inquilino de propertyId1, sin voto que delegar
let representativeUserId: string;
let otherEstateUserId: string; // sin ningún vínculo con esta finca
let propertyId1: string;
let bUser: AuthenticatedUser;
let ownerUser: AuthenticatedUser;
let tenantUser: AuthenticatedUser;

function storageStub() {
  return { assertAllowed: jest.fn(), put: jest.fn().mockResolvedValue('s3-key'), get: jest.fn() };
}

function makeService() {
  return new MeetingVoteDelegationsService(
    prisma as unknown as PrismaService,
    estateAccess,
    storageStub() as any,
  );
}

interface Fixture {
  meetingIds: string[];
}
function emptyFixture(): Fixture {
  return { meetingIds: [] };
}
async function cleanup(fixture: Fixture): Promise<void> {
  if (fixture.meetingIds.length) {
    await prisma.meetingVoteDelegation.deleteMany({ where: { meetingId: { in: fixture.meetingIds } } });
    await prisma.meetingState.deleteMany({ where: { meetingId: { in: fixture.meetingIds } } });
    await prisma.meeting.deleteMany({ where: { id: { in: fixture.meetingIds } } });
  }
}

async function createMeeting() {
  return prisma.meeting.create({
    data: {
      estateId,
      title: 'Junta de prueba — delegaciones',
      type: 'ordinaria',
      scheduledAt1: new Date(Date.now() + 60 * 60 * 1000),
      scheduledAt2: new Date(Date.now() + 2 * 60 * 60 * 1000),
      agenda: [{ id: 'p1', title: 'Punto único' }],
      convokedBy: 'presidente',
      signerRole: 'presidente',
      attendeeEmails: [],
      includeJitsi: false,
      createdByUserId: bUserId,
    },
  });
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: { name: 'Gestora de prueba (delegaciones)', cif: CIF, plan: 'BASE', tier: 'basic', usersMax: 5, status: 'Activa' },
  });
  administratorId = admin.id;

  const estate = await prisma.estate.create({
    data: { administratorId, name: 'Finca de prueba — delegaciones', type: 'Edificio', address: 'Calle Falsa 2020', location: 'Madrid' },
  });
  estateId = estate.id;

  const b = await prisma.user.create({
    data: { email: `admin-deleg-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Gestora Admin', role: 'B', administratorId },
  });
  bUserId = b.id;
  bUser = { id: bUserId, role: 'B' as AppRole, estateIds: [estateId], administratorId };

  const owner = await prisma.user.create({
    data: { email: `titular-deleg-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Vecina Titular', role: 'C' },
  });
  ownerUserId = owner.id;
  ownerUser = { id: ownerUserId, role: 'C' as AppRole, estateIds: [estateId], administratorId: null };

  const tenant = await prisma.user.create({
    data: { email: `inquilino-deleg-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Inquilino', role: 'C' },
  });
  tenantUserId = tenant.id;
  tenantUser = { id: tenantUserId, role: 'C' as AppRole, estateIds: [estateId], administratorId: null };

  const rep = await prisma.user.create({
    data: { email: `representante-deleg-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Representante', role: 'C' },
  });
  representativeUserId = rep.id;

  const other = await prisma.user.create({
    data: { email: `ajeno-deleg-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Ajeno', role: 'C' },
  });
  otherEstateUserId = other.id;

  const p1 = await prisma.property.create({
    data: { estateId, type: 'Piso', status: 'Ocupado', staircase: '1', floor: '1', door: 'A', quotaMonthly: '50.00', participationQuota: '25.00' },
  });
  propertyId1 = p1.id;

  await prisma.propertyMembership.create({
    data: { propertyId: propertyId1, userId: ownerUserId, roleType: 'Propietario', status: 'linked', isPrimaryContact: true, linkedAt: new Date() },
  });
  await prisma.propertyMembership.create({
    data: { propertyId: propertyId1, userId: tenantUserId, roleType: 'Inquilino', status: 'linked', isPrimaryContact: false, linkedAt: new Date() },
  });
});

afterAll(async () => {
  await prisma.propertyMembership.deleteMany({ where: { propertyId: propertyId1 } });
  await prisma.property.deleteMany({ where: { id: propertyId1 } });
  await prisma.user.deleteMany({ where: { id: { in: [bUserId, ownerUserId, tenantUserId, representativeUserId, otherEstateUserId] } } });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

describe('MeetingVoteDelegationsService', () => {
  describe('create', () => {
    it('el propio titular delega su voto en el representante', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();

        const created = await service.create(
          meeting.id,
          { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email, notes: 'Nota' },
          ownerUser,
        );

        expect(created.delegatorUserId).toBe(ownerUserId);
        expect(created.representativeUserId).toBe(representativeUserId);
        expect(created.revokedAt).toBeNull();
      } finally {
        await cleanup(fx);
      }
    });

    it('admite un representante externo sin cuenta, identificado por nombre y DNI', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();

        const created = await service.create(
          meeting.id,
          { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeName: ' Marta Gil Soto ', representativeDni: '12.345.678-z' },
          ownerUser,
        );

        expect(created.representativeUserId).toBeNull();
        expect(created.representativeName).toBe('Marta Gil Soto');
        expect(created.representativeDni).toBe('12345678Z');
      } finally {
        await cleanup(fx);
      }
    });

    it('rechaza un DNI con letra de control incorrecta y la mezcla de email con nombre/DNI', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;
        const base = { propertyId: propertyId1, delegatorUserId: ownerUserId };

        await expect(
          service.create(meeting.id, { ...base, representativeName: 'Marta Gil Soto', representativeDni: '12345678A' }, ownerUser),
        ).rejects.toThrow('DNI/NIE');
        await expect(
          service.create(meeting.id, { ...base, representativeEmail: repEmail, representativeName: 'Marta Gil Soto', representativeDni: '12345678Z' }, ownerUser),
        ).rejects.toThrow('no ambos');
        await expect(service.create(meeting.id, base, ownerUser)).rejects.toThrow();
      } finally {
        await cleanup(fx);
      }
    });

    it('registrar una nueva delegación auto-revoca la anterior de la misma junta+propiedad', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;
        const otherEmail = (await prisma.user.findUniqueOrThrow({ where: { id: otherEstateUserId } })).email;

        const first = await service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: repEmail }, ownerUser);
        const second = await service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: otherEmail }, ownerUser);

        const firstReloaded = await prisma.meetingVoteDelegation.findUniqueOrThrow({ where: { id: first.id } });
        expect(firstReloaded.revokedAt).not.toBeNull();
        expect(second.revokedAt).toBeNull();
      } finally {
        await cleanup(fx);
      }
    });

    it('rechaza la autodelegación', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const ownerEmail = (await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } })).email;

        await expect(
          service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: ownerEmail }, ownerUser),
        ).rejects.toThrow();
      } finally {
        await cleanup(fx);
      }
    });

    it('rechaza si el delegador es inquilino sin representación (sin voto que delegar)', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;

        await expect(
          service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: tenantUserId, representativeEmail: repEmail }, tenantUser),
        ).rejects.toThrow();
      } finally {
        await cleanup(fx);
      }
    });

    it('email de representante sin cuenta en Domora da un error claro', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();

        await expect(
          service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: 'nadie@no-existe.test' }, ownerUser),
        ).rejects.toThrow();
      } finally {
        await cleanup(fx);
      }
    });

    it('un vecino no puede delegar el voto de OTRO vecino', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;

        await expect(
          service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: repEmail }, tenantUser),
        ).rejects.toThrow();
      } finally {
        await cleanup(fx);
      }
    });

    it('la gestora (rol B) puede registrar la delegación en nombre del titular', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;

        const created = await service.create(
          meeting.id,
          { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: repEmail },
          bUser,
        );
        expect(created.createdByUserId).toBe(bUserId);
      } finally {
        await cleanup(fx);
      }
    });
  });

  describe('list — autorización por rol', () => {
    it('rol C solo ve las delegaciones donde participa; rol B las ve todas', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;
        await service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: repEmail }, ownerUser);

        const asOwner = await service.list(meeting.id, ownerUser);
        const asTenant = await service.list(meeting.id, tenantUser);
        const asB = await service.list(meeting.id, bUser);

        expect(asOwner).toHaveLength(1);
        expect(asTenant).toHaveLength(0);
        expect(asB).toHaveLength(1);
      } finally {
        await cleanup(fx);
      }
    });
  });

  describe('revoke', () => {
    it('el propio delegador puede revocar; deja motivo y quién la revocó', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;
        const created = await service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: repEmail }, ownerUser);

        const revoked = await service.revoke(meeting.id, created.id, { reason: 'Ya no hace falta' }, ownerUser);

        expect(revoked.revokedAt).not.toBeNull();
        expect(revoked.revokedByUserId).toBe(ownerUserId);
        expect(revoked.revocationReason).toBe('Ya no hace falta');
      } finally {
        await cleanup(fx);
      }
    });

    it('otro vecino sin relación con la delegación no puede revocarla', async () => {
      const fx = emptyFixture();
      try {
        const meeting = await createMeeting();
        fx.meetingIds.push(meeting.id);
        const service = makeService();
        const repEmail = (await prisma.user.findUniqueOrThrow({ where: { id: representativeUserId } })).email;
        const created = await service.create(meeting.id, { propertyId: propertyId1, delegatorUserId: ownerUserId, representativeEmail: repEmail }, ownerUser);

        await expect(service.revoke(meeting.id, created.id, {}, tenantUser)).rejects.toThrow();
      } finally {
        await cleanup(fx);
      }
    });
  });
});
