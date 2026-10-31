import type { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DirectMessagesService } from './direct-messages.service';
import { DirectMessageEditsService } from './direct-message-edits.service';
import type { StorageService } from '../files/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksService } from '../notifications/tasks.service';
import type { PushService } from '../push/push.service';
import { MailService } from '../mail/mail.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Tarea 2 ("Notice Board") — `DirectMessagesModule` es en la práctica la
 * implementación más cercana a "vecino↔vecino"/"vecino→admin" que existe
 * hoy (`listContacts` ya devuelve ambos), pero no tenía NINGÚN test de
 * backend pese a lógica no trivial de privacidad/elegibilidad. Integración
 * contra Postgres real — mismo criterio que el resto de specs de este
 * fichero-hermano (`communication-threads-targeting.spec.ts`): es
 * exactamente el tipo de consulta multi-modelo relacional que un mock no
 * verifica de verdad. Solo se prueba comportamiento ya existente, no se
 * cambia nada del servicio.
 */
const prisma = createPrismaClient();
// Sin SMTP_HOST: MailService degrada a loguear en vez de enviar de verdad
// (mismo criterio que en desarrollo) — no hace falta un servidor SMTP real
// para que `sendMessage` (que ahora también avisa al destinatario) corra.
const config = { get: () => undefined } as unknown as ConfigService;
const mail = new MailService(config);
const tasks = new TasksService(prisma as unknown as PrismaService);
const notifications = new NotificationsService(
  prisma as unknown as PrismaService,
  mail,
  config,
  tasks,
  { sendToUser: async () => {} } as unknown as PushService,
);
const service = new DirectMessagesService(
  prisma as unknown as PrismaService,
  notifications,
);

const CIF = 'TESTGR-DM-2';
const CIF_OTHER = 'TESTGR-DM-2-OTRA';

let administratorId: string;
let otherAdministratorId: string;
let estateId: string;
let otherEstateId: string; // finca de otra gestora — sin vínculo con `estateId`
let bUserId: string; // gestora de `estateId`
let otherBUserId: string; // gestora de `otherEstateId` — sin finca en común con nadie de este fixture
let cUserId: string; // vecino con ajustes por defecto (anyone_linked)
let cNobodyUserId: string; // vecino con allowDirectMessages: nobody en su única membresía
let cMultiUserId: string; // vecino con 2 membresías en la misma finca: una 'nobody', otra 'neighbors'
let propertyId: string;
let propertyNobodyId: string;
let propertyMultiId1: string;
let propertyMultiId2: string;

function user(
  id: string,
  role: AppRole,
  estateIds: string[],
  administratorId: string | null = null,
): AuthenticatedUser {
  return { id, role, estateIds, administratorId };
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: {
      name: 'Gestora de prueba (DM)',
      cif: CIF,
      plan: 'BASE',
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
    },
  });
  administratorId = admin.id;
  const otherAdmin = await prisma.administrator.create({
    data: {
      name: 'Otra gestora (DM)',
      cif: CIF_OTHER,
      plan: 'BASE',
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
    },
  });
  otherAdministratorId = otherAdmin.id;

  const estate = await prisma.estate.create({
    data: {
      administratorId,
      name: 'Finca de prueba — DM',
      type: 'Edificio',
      address: 'Calle Falsa 3030',
      location: 'Madrid',
    },
  });
  estateId = estate.id;
  const otherEstate = await prisma.estate.create({
    data: {
      administratorId: otherAdministratorId,
      name: 'Finca ajena — DM',
      type: 'Edificio',
      address: 'Calle Falsa 3031',
      location: 'Madrid',
    },
  });
  otherEstateId = otherEstate.id;

  const b = await prisma.user.create({
    data: {
      email: `admin-dm-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Gestora Admin',
      role: 'B',
      administratorId,
    },
  });
  bUserId = b.id;
  const otherB = await prisma.user.create({
    data: {
      email: `otro-admin-dm-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Otra Gestora',
      role: 'B',
      administratorId: otherAdministratorId,
    },
  });
  otherBUserId = otherB.id;

  const c = await prisma.user.create({
    data: {
      email: `vecino-dm-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Vecino Normal',
      role: 'C',
    },
  });
  cUserId = c.id;
  const cNobody = await prisma.user.create({
    data: {
      email: `vecino-nobody-dm-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Vecino Reservado',
      role: 'C',
    },
  });
  cNobodyUserId = cNobody.id;
  const cMulti = await prisma.user.create({
    data: {
      email: `vecino-multi-dm-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Vecino Multi-piso',
      role: 'C',
    },
  });
  cMultiUserId = cMulti.id;

  const p = await prisma.property.create({
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
  propertyId = p.id;
  const pNobody = await prisma.property.create({
    data: {
      estateId,
      type: 'Piso',
      status: 'Ocupado',
      staircase: '1',
      floor: '2',
      door: 'A',
      quotaMonthly: '50.00',
    },
  });
  propertyNobodyId = pNobody.id;
  const pMulti1 = await prisma.property.create({
    data: {
      estateId,
      type: 'Piso',
      status: 'Ocupado',
      staircase: '1',
      floor: '3',
      door: 'A',
      quotaMonthly: '50.00',
    },
  });
  propertyMultiId1 = pMulti1.id;
  const pMulti2 = await prisma.property.create({
    data: {
      estateId,
      type: 'Piso',
      status: 'Ocupado',
      staircase: '1',
      floor: '3',
      door: 'B',
      quotaMonthly: '50.00',
    },
  });
  propertyMultiId2 = pMulti2.id;

  await prisma.propertyMembership.create({
    data: {
      propertyId,
      userId: cUserId,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });

  const membershipNobody = await prisma.propertyMembership.create({
    data: {
      propertyId: propertyNobodyId,
      userId: cNobodyUserId,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });
  await prisma.propertyMembershipSettings.create({
    data: { membershipId: membershipNobody.id, allowDirectMessages: 'nobody' },
  });

  const membershipMulti1 = await prisma.propertyMembership.create({
    data: {
      propertyId: propertyMultiId1,
      userId: cMultiUserId,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });
  await prisma.propertyMembershipSettings.create({
    data: { membershipId: membershipMulti1.id, allowDirectMessages: 'nobody' },
  });
  await prisma.propertyMembership.create({
    data: {
      propertyId: propertyMultiId2,
      userId: cMultiUserId,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: false,
      linkedAt: new Date(),
    },
  });
  // Segunda membresía de cMulti sin settings propios -> cae al default
  // (`neighbors`), que SÍ permite mensajes — "más permisiva gana".
});

afterAll(async () => {
  await prisma.directMessage.deleteMany({});
  await prisma.directMessageParticipant.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.propertyMembershipSettings.deleteMany({
    where: {
      membershipId: {
        in: (
          await prisma.propertyMembership.findMany({
            where: {
              propertyId: {
                in: [
                  propertyId,
                  propertyNobodyId,
                  propertyMultiId1,
                  propertyMultiId2,
                ],
              },
            },
            select: { id: true },
          })
        ).map((m) => m.id),
      },
    },
  });
  await prisma.propertyMembership.deleteMany({
    where: {
      propertyId: {
        in: [propertyId, propertyNobodyId, propertyMultiId1, propertyMultiId2],
      },
    },
  });
  await prisma.property.deleteMany({
    where: {
      id: {
        in: [propertyId, propertyNobodyId, propertyMultiId1, propertyMultiId2],
      },
    },
  });
  await prisma.user.deleteMany({
    where: {
      id: { in: [bUserId, otherBUserId, cUserId, cNobodyUserId, cMultiUserId] },
    },
  });
  await prisma.estate.deleteMany({
    where: { id: { in: [estateId, otherEstateId] } },
  });
  await prisma.administrator.deleteMany({
    where: { id: { in: [administratorId, otherAdministratorId] } },
  });
  await prisma.$disconnect();
});

describe('DirectMessagesService.listContacts', () => {
  it('un vecino ve a otros propietarios vinculados de su finca que admiten DM, y al admin B de esa finca', async () => {
    const contacts = await service.listContacts(user(cUserId, 'C', [estateId]));
    const contactIds = contacts.map((c) => c.userId);

    expect(contactIds).toContain(bUserId); // vecino→admin
    expect(contactIds).not.toContain(cNobodyUserId); // excluido por su propia política 'nobody'
  });

  it('un admin B ve a los propietarios de las fincas que administra', async () => {
    const contacts = await service.listContacts(
      user(bUserId, 'B', [estateId], administratorId),
    );
    const contactIds = contacts.map((c) => c.userId);

    expect(contactIds).toContain(cUserId);
    expect(contactIds).not.toContain(cNobodyUserId);
  });

  it('sin fincas vinculadas, no hay contactos', async () => {
    const contacts = await service.listContacts(user(cUserId, 'C', []));
    expect(contacts).toEqual([]);
  });
});

describe('DirectMessagesService.sendMessage — findAnySharedEstateId / assertEligibleRecipient', () => {
  it('no puedes enviarte un mensaje a ti mismo', async () => {
    await expect(
      service.sendMessage(
        { recipientUserId: cUserId, text: 'hola' } as any,
        user(cUserId, 'C', [estateId]),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('sin finca en común, se rechaza', async () => {
    await expect(
      service.sendMessage(
        { recipientUserId: otherBUserId, text: 'hola' } as any,
        user(cUserId, 'C', [estateId]),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('un vecino con política "nobody" en su única membresía rechaza el mensaje', async () => {
    await expect(
      service.sendMessage(
        { recipientUserId: cNobodyUserId, text: 'hola' } as any,
        user(cUserId, 'C', [estateId]),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('"más permisiva gana": un vecino con una membresía "nobody" y otra "neighbors" en la misma finca SÍ admite mensajes', async () => {
    const created = await service.sendMessage(
      { recipientUserId: cMultiUserId, text: 'hola vecino' } as any,
      user(cUserId, 'C', [estateId]),
    );
    expect(created.text).toBe('hola vecino');

    // limpieza puntual de este mensaje/conversación para no interferir con el siguiente test
    await prisma.directMessage.deleteMany({
      where: { conversationId: created.conversationId },
    });
    await prisma.directMessageParticipant.deleteMany({
      where: { conversationId: created.conversationId },
    });
    await prisma.conversation.delete({ where: { id: created.conversationId } });
  });

  it('B con finca administrada en común con el vecino es un destinatario elegible por defecto', async () => {
    const created = await service.sendMessage(
      { recipientUserId: bUserId, text: 'Consulta sobre la cuota' } as any,
      user(cUserId, 'C', [estateId]),
    );
    expect(created.text).toBe('Consulta sobre la cuota');

    // segundo mensaje entre el mismo par reutiliza la MISMA conversación, no crea otra
    const second = await service.sendMessage(
      { recipientUserId: bUserId, text: 'Otra consulta' } as any,
      user(cUserId, 'C', [estateId]),
    );
    expect(second.conversationId).toBe(created.conversationId);

    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: cUserId } } },
    });
    expect(conversations).toHaveLength(1);

    await prisma.directMessage.deleteMany({
      where: { conversationId: created.conversationId },
    });
    await prisma.directMessageParticipant.deleteMany({
      where: { conversationId: created.conversationId },
    });
    await prisma.conversation.delete({ where: { id: created.conversationId } });
  });
});

describe('DirectMessagesService — resolución de nombre a mostrar', () => {
  it('displayNamePolicy "alias" sin alias cargado cae a fullName', async () => {
    const membership = await prisma.propertyMembership.findFirstOrThrow({
      where: { propertyId, userId: cUserId },
    });
    await prisma.propertyMembershipSettings.upsert({
      where: { membershipId: membership.id },
      update: { displayNamePolicy: 'alias', displayAlias: null },
      create: { membershipId: membership.id, displayNamePolicy: 'alias' },
    });

    const contacts = await service.listContacts(
      user(bUserId, 'B', [estateId], administratorId),
    );
    const contact = contacts.find((c) => c.userId === cUserId)!;
    expect(contact.displayName).toBe('Vecino Normal');

    await prisma.propertyMembershipSettings.update({
      where: { membershipId: membership.id },
      data: { displayNamePolicy: 'full_name' },
    });
  });
});

describe('DirectMessagesService — edición y borrado (Postgres real)', () => {
  const edits = new DirectMessageEditsService(
    prisma as unknown as PrismaService,
    { delete: async () => {} } as unknown as StorageService,
    service,
  );
  let conversationId: string;

  afterAll(async () => {
    if (!conversationId) return;
    await prisma.directMessage.deleteMany({ where: { conversationId } });
    await prisma.directMessageParticipant.deleteMany({
      where: { conversationId },
    });
    await prisma.conversation.delete({ where: { id: conversationId } });
  });

  it('abre la conversación con el primer mensaje', async () => {
    const b = user(bUserId, 'B', [estateId], administratorId);
    const first = await service.sendMessage(
      { recipientUserId: cUserId, text: 'Hola' },
      b,
    );
    conversationId = first.conversationId;
    const rows = await service.listConversations(b);
    expect(
      rows.find((row) => row.id === conversationId)?.lastMessagePreview,
    ).toBe('Hola');
  });

  it('edita el texto, marca editedAt y rechaza que otro usuario lo toque', async () => {
    const b = user(bUserId, 'B', [estateId], administratorId);
    const message = await service.sendMessage(
      { conversationId, text: 'Texto original' },
      b,
    );
    const edited = await edits.edit(message.id, 'Texto corregido', b);
    expect(edited.text).toBe('Texto corregido');
    expect(edited.editedAt).toBeInstanceOf(Date);
    await expect(
      edits.edit(message.id, 'Intruso', user(cUserId, 'C', [estateId])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      edits.remove(message.id, user(cUserId, 'C', [estateId])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('al borrar el mensaje queda sin texto, la bandeja lo avisa y el otro lado no lo cuenta como no leído', async () => {
    const b = user(bUserId, 'B', [estateId], administratorId);
    const c = user(cUserId, 'C', [estateId]);
    await service.markRead(conversationId, c);
    const message = await service.sendMessage(
      { conversationId, text: 'Se arrepiente' },
      b,
    );
    await edits.remove(message.id, b);
    const thread = await service.listMessages(conversationId, b);
    const deleted = thread.find((row) => row.id === message.id)!;
    expect(deleted).toMatchObject({ text: '' });
    expect(deleted.deletedAt).toBeInstanceOf(Date);
    const inbox = await service.listConversations(c);
    const row = inbox.find((item) => item.id === conversationId)!;
    expect(row.lastMessagePreview).toBe('Este mensaje ha sido borrado');
    expect(row.unreadCount).toBe(0);
  });

  it('readByRecipient pasa a true cuando el otro participante abre la conversación', async () => {
    const b = user(bUserId, 'B', [estateId], administratorId);
    const c = user(cUserId, 'C', [estateId]);
    const message = await service.sendMessage(
      { conversationId, text: 'Ya lo ves?' },
      b,
    );
    expect(
      (await service.listMessages(conversationId, b)).find(
        (row) => row.id === message.id,
      )?.readByRecipient,
    ).toBe(false);
    await service.markRead(conversationId, c);
    expect(
      (await service.listMessages(conversationId, b)).find(
        (row) => row.id === message.id,
      )?.readByRecipient,
    ).toBe(true);
  });

  it('eliminar la conversación solo la oculta para quien la elimina y un mensaje nuevo la devuelve con todo su historial', async () => {
    const b = user(bUserId, 'B', [estateId], administratorId);
    const c = user(cUserId, 'C', [estateId]);
    const historyBefore = (await service.listMessages(conversationId, b))
      .length;

    await service.hideConversation(conversationId, b);
    expect(
      (await service.listConversations(b)).some(
        (row) => row.id === conversationId,
      ),
    ).toBe(false);
    expect(
      (await service.listConversations(c)).some(
        (row) => row.id === conversationId,
      ),
    ).toBe(true);
    expect(await service.listMessages(conversationId, b)).toHaveLength(
      historyBefore,
    );
    // El contacto sigue apuntando a la conversación eliminada para poder mostrar su historial antes de escribir.
    expect(
      (await service.listContacts(b)).find(
        (contact) => contact.userId === cUserId,
      )?.conversationId,
    ).toBe(conversationId);
    await expect(
      service.hideConversation(
        conversationId,
        user('00000000-0000-4000-8000-000000000000', 'B', []),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    // Quien escribe de nuevo (aquí desde el contacto, sin conversationId) reutiliza la conversación y su historial.
    await service.sendMessage(
      { recipientUserId: cUserId, text: 'Retomamos la conversación' },
      b,
    );
    const back = (await service.listConversations(b)).find(
      (row) => row.id === conversationId,
    );
    expect(back?.lastMessagePreview).toBe('Retomamos la conversación');
    expect(await service.listMessages(conversationId, b)).toHaveLength(
      historyBefore + 1,
    );
  });

  it('si la otra persona había eliminado la conversación, un mensaje nuevo se la devuelve', async () => {
    const b = user(bUserId, 'B', [estateId], administratorId);
    const c = user(cUserId, 'C', [estateId]);
    await service.hideConversation(conversationId, c);
    expect(
      (await service.listConversations(c)).some(
        (row) => row.id === conversationId,
      ),
    ).toBe(false);
    await service.sendMessage({ conversationId, text: 'Sigues ahí?' }, b);
    const row = (await service.listConversations(c)).find(
      (item) => item.id === conversationId,
    );
    expect(row?.unreadCount).toBeGreaterThan(0);
  });
});
