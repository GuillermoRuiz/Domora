import { ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { ResourcesService } from './resources.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { TasksService } from '../notifications/tasks.service';
import type { PushService } from '../push/push.service';
import type { MailService } from '../mail/mail.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Tarea 2 ("Notice Board") — lo que el tracker daba por pendiente
 * (vecino->admin/vecino<->vecino) ya estaba resuelto; lo que de verdad
 * faltaba y se cubre aquí es: destinatario dirigido a una propiedad,
 * hilo de respuestas, notificación fehaciente (LPH art. 9.1.h) con su
 * cómputo de 3 días naturales, fijado, lecturas y el envío de email para
 * Urgente/legal. Integración contra Postgres real — es exactamente el tipo
 * de visibilidad multi-modelo y agregado temporal que un mock no verifica
 * de verdad.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();

const CIF = 'TESTGR-COMMS-2';

let administratorId: string;
let estateId: string;
let bUserId: string;
let cUserId1: string; // dueño de la propiedad P1 (destino del comunicado dirigido)
let cUserId2: string; // dueño de la propiedad P2 (misma finca, sin vínculo a P1)
let propertyId1: string;
let propertyId2: string;
let bUser: AuthenticatedUser;
let cUser1: AuthenticatedUser;
let cUser2: AuthenticatedUser;

interface Fixture {
  communicationIds: string[];
}

function emptyFixture(): Fixture {
  return { communicationIds: [] };
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (fixture.communicationIds.length) {
    await prisma.communicationReply.deleteMany({
      where: { communicationId: { in: fixture.communicationIds } },
    });
    await prisma.communicationAttachment.deleteMany({
      where: { communicationId: { in: fixture.communicationIds } },
    });
    await prisma.resourceRead.deleteMany({
      where: {
        sourceType: 'communication',
        sourceId: { in: fixture.communicationIds },
      },
    });
    await prisma.communication.deleteMany({
      where: { id: { in: fixture.communicationIds } },
    });
  }
}

/**
 * Solo se hace stub del transporte de salida (`sendNotificationEmail`) — el
 * resto de `NotificationsService` (resolución de destinatarios/preferencias)
 * corre real, contra el mismo Postgres, que es la parte que de verdad
 * interesa verificar aquí.
 */
function mailStub() {
  return { sendNotificationEmail: jest.fn().mockResolvedValue(undefined) };
}

function makeService(mail = mailStub()) {
  const notifications = new NotificationsService(
    prisma as unknown as PrismaService,
    mail as unknown as MailService,
    { get: () => 'http://localhost:4200' } as any,
    {} as unknown as TasksService,
    { sendToUser: async () => {} } as unknown as PushService,
  );
  return {
    service: new ResourcesService(
      prisma as unknown as PrismaService,
      estateAccess,
      { get: () => 'http://localhost:4200' } as any,
      {} as any,
      notifications,
      new RagAuthorizationService(prisma as unknown as PrismaService),
    ),
    mail,
  };
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: {
      name: 'Gestora de prueba (comunicados)',
      cif: CIF,
      plan: 'BASE',
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
    },
  });
  administratorId = admin.id;

  const estate = await prisma.estate.create({
    data: {
      administratorId,
      name: 'Finca de prueba — comunicados',
      type: 'Edificio',
      address: 'Calle Falsa 2020',
      location: 'Madrid',
    },
  });
  estateId = estate.id;

  const b = await prisma.user.create({
    data: {
      email: `admin-comms-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Gestora Admin',
      role: 'B',
      administratorId,
    },
  });
  bUserId = b.id;
  bUser = {
    id: bUserId,
    role: 'B' as AppRole,
    estateIds: [estateId],
    administratorId,
  };

  const c1 = await prisma.user.create({
    data: {
      email: `vecino1-comms-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Vecino Uno',
      role: 'C',
    },
  });
  cUserId1 = c1.id;

  const c2 = await prisma.user.create({
    data: {
      email: `vecino2-comms-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Vecino Dos',
      role: 'C',
    },
  });
  cUserId2 = c2.id;

  const p1 = await prisma.property.create({
    data: {
      estateId,
      type: 'Piso',
      status: 'Ocupado',
      staircase: '1',
      floor: '1',
      door: 'A',
      quotaMonthly: '50.00',
    },
  });
  propertyId1 = p1.id;
  const p2 = await prisma.property.create({
    data: {
      estateId,
      type: 'Piso',
      status: 'Ocupado',
      staircase: '1',
      floor: '2',
      door: 'B',
      quotaMonthly: '50.00',
    },
  });
  propertyId2 = p2.id;

  await prisma.propertyMembership.create({
    data: {
      propertyId: propertyId1,
      userId: cUserId1,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });
  await prisma.propertyMembership.create({
    data: {
      propertyId: propertyId2,
      userId: cUserId2,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });

  cUser1 = {
    id: cUserId1,
    role: 'C' as AppRole,
    estateIds: [estateId],
    administratorId: null,
  };
  cUser2 = {
    id: cUserId2,
    role: 'C' as AppRole,
    estateIds: [estateId],
    administratorId: null,
  };
});

afterAll(async () => {
  await prisma.propertyMembership.deleteMany({
    where: { propertyId: { in: [propertyId1, propertyId2] } },
  });
  await prisma.property.deleteMany({
    where: { id: { in: [propertyId1, propertyId2] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [bUserId, cUserId1, cUserId2] } },
  });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

describe('ResourcesService — destinatario dirigido (targetPropertyId)', () => {
  it('un comunicado dirigido a P1 lo ve el vecino de P1 pero no el de P2; B siempre lo ve', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const created = await service.createCommunication(
        estateId,
        {
          title: 'Aviso para el portal 1',
          body: 'Reunión de vecinos del portal.',
          targetPropertyId: propertyId1,
        } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);

      // Publicar un comunicado queda en la actividad de quien lo publica.
      const logged = await prisma.activityLogEntry.findMany({ where: { subjectType: 'communication', subjectId: created.id } });
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({ actorUserId: bUser.id, verb: 'published', estateId, summary: 'Comunicado "Aviso para el portal 1" publicado' });
      await prisma.activityLogEntry.deleteMany({ where: { subjectType: 'communication', subjectId: created.id } });

      const pageC1 = await service.listCommunications(estateId, cUser1, {});
      const pageC2 = await service.listCommunications(estateId, cUser2, {});
      const pageB = await service.listCommunications(estateId, bUser, {});

      expect(pageC1.items.some((c) => c.id === created.id)).toBe(true);
      expect(pageC2.items.some((c) => c.id === created.id)).toBe(false);
      expect(pageB.items.some((c) => c.id === created.id)).toBe(true);
    } finally {
      await cleanup(fx);
    }
  });

  it('rechaza un targetPropertyId que no pertenece a la finca', async () => {
    const { service } = makeService();
    await expect(
      service.createCommunication(
        estateId,
        {
          title: 'x',
          body: 'y',
          targetPropertyId: '00000000-0000-0000-0000-000000000000',
        } as any,
        bUser,
      ),
    ).rejects.toThrow();
  });

  it('un comunicado dirigido a P1 NO genera alerta para el vecino de P2', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const created = await service.createCommunication(
        estateId,
        {
          title: 'Aviso solo para P1',
          body: 'Solo te concierne si vives en el portal 1.',
          targetPropertyId: propertyId1,
        } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);

      const alertsC1 = await service.listAlerts(cUser1);
      const alertsC2 = await service.listAlerts(cUser2);

      expect(
        alertsC1.some(
          (a) => a.sourceType === 'communication' && a.sourceId === created.id,
        ),
      ).toBe(true);
      expect(
        alertsC2.some(
          (a) => a.sourceType === 'communication' && a.sourceId === created.id,
        ),
      ).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });
});

describe('ResourcesService — hilo de respuestas', () => {
  it('un vecino responde al comunicado de otro; B responde también; el orden y la autoría se resuelven bien', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const created = await service.createCommunication(
        estateId,
        {
          title: 'Se busca gato perdido',
          body: 'Blanco y negro, portal 1.',
        } as any,
        cUser1,
      );
      fx.communicationIds.push(created.id);

      const reply1 = await service.addCommunicationReply(
        created.id,
        { text: 'Lo vi cerca del garaje' },
        cUser2,
      );
      expect(reply1.role).toBe('Propietario');
      const reply2 = await service.addCommunicationReply(
        created.id,
        { text: 'Avisamos al servicio de portería' },
        bUser,
      );
      expect(reply2.role).toBe('Administrador');

      const page = await service.listCommunications(estateId, cUser1, {});
      const withReplies = page.items.find((c) => c.id === created.id)!;
      expect(withReplies.replies).toHaveLength(2);
      expect(withReplies.replies![0].id).toBe(reply1.id);
      expect(withReplies.replies![1].id).toBe(reply2.id);
    } finally {
      await cleanup(fx);
    }
  });

  it('un vecino no puede responder a un comunicado dirigido a una propiedad ajena', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const created = await service.createCommunication(
        estateId,
        {
          title: 'Solo para portal 1',
          body: 'x',
          targetPropertyId: propertyId1,
        } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);

      await expect(
        service.addCommunicationReply(created.id, { text: 'x' }, cUser2),
      ).rejects.toThrow();
    } finally {
      await cleanup(fx);
    }
  });

  it('B modera: borra la respuesta de un vecino; el vecino NO puede borrar la de otro', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const created = await service.createCommunication(
        estateId,
        { title: 'x', body: 'y' } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);
      const reply = await service.addCommunicationReply(
        created.id,
        { text: 'comentario' },
        cUser1,
      );

      await expect(
        service.deleteCommunicationReply(created.id, reply.id, cUser2),
      ).rejects.toThrow(ForbiddenException);

      await service.deleteCommunicationReply(created.id, reply.id, bUser);
      const page = await service.listCommunications(estateId, bUser, {});
      const comm = page.items.find((c) => c.id === created.id)!;
      expect(comm.replies).toHaveLength(0);
    } finally {
      await cleanup(fx);
    }
  });
});

describe('ResourcesService — notificación fehaciente (LPH art. 9.1.h)', () => {
  it('recién creada, legalNoticeEffective es false; tras retrasar `date` 4 días, pasa a true', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const created = await service.createCommunication(
        estateId,
        {
          title: 'Notificación fehaciente',
          body: 'Comunicado por tablón, domicilio desconocido.',
          isLegalNotice: true,
          legalNoticeSignerRole: 'secretario',
          legalNoticeSignerName: 'Ana Pérez',
          legalNoticeReason: 'Domicilio desconocido del propietario',
          legalNoticeCountersignedByPresident: true,
        } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);
      expect((created as any).legalNoticeEffective).toBe(false);
      expect((created as any).legalNoticeEffectiveAt).toBeTruthy();

      await prisma.communication.update({
        where: { id: created.id },
        data: { date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000) },
      });

      const page = await service.listCommunications(estateId, bUser, {});
      const reloaded = page.items.find((c) => c.id === created.id)!;
      expect((reloaded as any).legalNoticeEffective).toBe(true);
      expect(reloaded.legalNoticeSignerRole).toBe('secretario');
      expect(reloaded.legalNoticeReason).toBe(
        'Domicilio desconocido del propietario',
      );
    } finally {
      await cleanup(fx);
    }
  });
});

describe('ResourcesService — fijado (pinnedAt)', () => {
  it('un comunicado más viejo pero fijado ordena antes que uno reciente sin fijar', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const older = await service.createCommunication(
        estateId,
        { title: 'Viejo', body: 'x' } as any,
        bUser,
      );
      fx.communicationIds.push(older.id);
      await prisma.communication.update({
        where: { id: older.id },
        data: { date: new Date(Date.now() - 60 * 60 * 1000) },
      });
      const newer = await service.createCommunication(
        estateId,
        { title: 'Nuevo', body: 'x' } as any,
        bUser,
      );
      fx.communicationIds.push(newer.id);

      await service.setCommunicationPinned(older.id, true, bUser);

      const page = await service.listCommunications(estateId, bUser, {});
      const ids = page.items.map((c) => c.id);
      expect(ids.indexOf(older.id)).toBeLessThan(ids.indexOf(newer.id));

      await service.setCommunicationPinned(older.id, false, bUser);
      const pageUnpinned = await service.listCommunications(
        estateId,
        bUser,
        {},
      );
      const idsUnpinned = pageUnpinned.items.map((c) => c.id);
      expect(idsUnpinned.indexOf(newer.id)).toBeLessThan(
        idsUnpinned.indexOf(older.id),
      );
    } finally {
      await cleanup(fx);
    }
  });
});

describe('ResourcesService — lecturas (A/B-only, ver controller)', () => {
  it('refleja quién de los destinatarios elegibles ya lo leyó', async () => {
    const fx = emptyFixture();
    try {
      const { service } = makeService();
      const created = await service.createCommunication(
        estateId,
        { title: 'x', body: 'y' } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);

      await service.markRead(cUserId1, 'communication', created.id);

      const reads = await service.listCommunicationReads(created.id, bUser);
      const read1 = reads.find((r) => r.userId === cUserId1)!;
      const read2 = reads.find((r) => r.userId === cUserId2)!;
      expect(read1.read).toBe(true);
      expect(read2.read).toBe(false);
    } finally {
      await cleanup(fx);
    }
  });
});

describe('ResourcesService — aviso por email (solo Urgente/notificación legal)', () => {
  it('un comunicado Urgente dispara un envío por cada destinatario elegible', async () => {
    const fx = emptyFixture();
    try {
      const { service, mail } = makeService();
      const created = await service.createCommunication(
        estateId,
        {
          title: 'Corte de agua urgente',
          body: 'x',
          category: 'Urgente',
        } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);
      // El envío es fire-and-forget; desde ID 22 cada entrega también
      // consulta las suscripciones push del destinatario (deliverTo), un
      // await más en la cadena por destinatario — 50ms ya no alcanza siempre.
      await new Promise((r) => setTimeout(r, 200));

      expect(mail.sendNotificationEmail).toHaveBeenCalled();
      const recipients = mail.sendNotificationEmail.mock.calls.map(
        (c: any[]) => c[0],
      );
      expect(recipients.length).toBeGreaterThanOrEqual(2); // ambos vecinos, notifyCommunications por defecto = email_push
    } finally {
      await cleanup(fx);
    }
  });

  it('un comunicado General NO dispara ningún envío', async () => {
    const fx = emptyFixture();
    try {
      const { service, mail } = makeService();
      const created = await service.createCommunication(
        estateId,
        { title: 'x', body: 'y' } as any,
        bUser,
      );
      fx.communicationIds.push(created.id);
      await new Promise((r) => setTimeout(r, 50));

      expect(mail.sendNotificationEmail).not.toHaveBeenCalled();
    } finally {
      await cleanup(fx);
    }
  });
});
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
