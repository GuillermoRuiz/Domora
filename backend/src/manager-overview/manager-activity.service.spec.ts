import { ForbiddenException } from '@nestjs/common';
import { DirectMessagesService } from '../direct-messages/direct-messages.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { StorageService } from '../files/storage.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createSupplier,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { ManagerActivityService } from './manager-activity.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** Integración contra Postgres real: solo la actividad propia, las 5 últimas, y que los cambios se registren. */
const prisma = createPrismaClient();
const access = new EstateAccessService();
const service = new ManagerActivityService(prisma as unknown as PrismaService, access);

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

let admin: AdministratorFixture;
let colleague: AdministratorFixture;
let other: AdministratorFixture;
let estateA: string;
let estateB: string;
let foreignEstate: string;

const entry = (actor: string, estateId: string | null, days: number, summary: string, subjectType: 'meeting' | 'message' = 'meeting') =>
  prisma.activityLogEntry.create({
    data: { actorUserId: actor, subjectType, subjectId: actor, verb: 'created', summary, occurredAt: ago(days), estateId, propertyId: null },
  });

beforeAll(async () => {
  admin = await createAdministrator(prisma, { name: 'Gestora de prueba (actividad)' });
  colleague = await createAdministrator(prisma, { name: 'Compañera (actividad)' });
  other = await createAdministrator(prisma, { name: 'Otra gestora (actividad)' });
  estateA = await createLedgerEstate(prisma, admin.administratorId, { estate: { name: 'Finca A — actividad' } });
  estateB = await createLedgerEstate(prisma, admin.administratorId, { estate: { name: 'Finca B — actividad' } });
  foreignEstate = await createLedgerEstate(prisma, other.administratorId, { estate: { name: 'Finca ajena — actividad' } });

  // 7 acciones propias (A: 1,3,5,7 días; B: 2,4 días; mensaje sin finca: 0 días), una ajena de una compañera
  // en la misma finca y una de otra gestora en su finca.
  for (const [days, estateId, text] of [[1, estateA, 'A1'], [3, estateA, 'A3'], [5, estateA, 'A5'], [7, estateA, 'A7'], [2, estateB, 'B2'], [4, estateB, 'B4']] as const) {
    await entry(admin.userId, estateId, days, text);
  }
  await entry(admin.userId, null, 0.5, 'Mensaje enviado a Ana', 'message');
  await entry(colleague.userId, estateA, 0.1, 'De la compañera');
  await entry(other.userId, foreignEstate, 0.1, 'De otra gestora');
});

afterAll(async () => {
  await prisma.activityLogEntry.deleteMany({ where: { actorUserId: { in: [admin.userId, colleague.userId, other.userId] } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, colleague.administratorId);
  await purgeAdministrator(prisma, other.administratorId);
  await prisma.$disconnect();
});

describe('ManagerActivityService.activity', () => {
  const user = () => roleB(admin, [estateA, estateB]);

  it('vista global: solo lo propio, las 5 últimas, la más reciente primero, con los mensajes incluidos', async () => {
    const { items } = await service.activity(user());
    expect(items.map((i) => i.summary)).toEqual(['Mensaje enviado a Ana', 'A1', 'B2', 'A3', 'B4']);
    expect(items[0]).toMatchObject({ estateId: null, estateName: null, subjectType: 'message' });
    expect(items[1]).toMatchObject({ estateId: estateA, estateName: 'Finca A — actividad' });
  });

  it('con una finca elegida solo salen las de esa finca y no los mensajes', async () => {
    const { items } = await service.activity(user(), estateA);
    expect(items.map((i) => i.summary)).toEqual(['A1', 'A3', 'A5', 'A7']);
  });

  it('una finca ajena es 403; sin fincas solo quedan los mensajes propios', async () => {
    await expect(service.activity(user(), foreignEstate)).rejects.toBeInstanceOf(ForbiddenException);
    const { items } = await service.activity(roleB(admin, []));
    expect(items.map((i) => i.summary)).toEqual(['Mensaje enviado a Ana']);
  });
});

describe('qué cambios se registran en la actividad', () => {
  it('actualizar un proveedor deja «Proveedor … actualizado»', async () => {
    const suppliers = new SuppliersService(prisma as unknown as PrismaService, access, undefined as unknown as StorageService);
    const supplierId = await createSupplier(prisma, estateA, admin.administratorId, { name: 'Fontanería Prueba S.L.' });
    await suppliers.updateSupplier(estateA, supplierId, { phone: '911 000 000' }, roleB(admin, [estateA]));
    const logged = await prisma.activityLogEntry.findFirst({ where: { subjectType: 'supplier', subjectId: supplierId } });
    expect(logged).toMatchObject({
      actorUserId: admin.userId, verb: 'updated', estateId: estateA, summary: 'Proveedor "Fontanería Prueba S.L." actualizado',
    });
    await prisma.activityLogEntry.deleteMany({ where: { subjectType: 'supplier', subjectId: supplierId } });
  });

  it('un mensaje enviado por el gestor se registra con el nombre del destinatario y sin texto; el de un propietario no', async () => {
    const messages = new DirectMessagesService(prisma as unknown as PrismaService, { notify: jest.fn() } as unknown as NotificationsService);
    const recipientId = await createOwnerUser(prisma, { fullName: 'Marta Ruiz' });
    const conversation = await prisma.conversation.create({
      data: { participants: { create: [{ userId: admin.userId }, { userId: recipientId }] } },
    });
    const message = await prisma.directMessage.create({
      data: { conversationId: conversation.id, senderId: admin.userId, text: 'Contenido confidencial' },
    });
    await messages.logSent(conversation.id, message.id, roleB(admin, [estateA]));
    const logged = await prisma.activityLogEntry.findFirst({ where: { subjectType: 'message', subjectId: message.id } });
    expect(logged).toMatchObject({ actorUserId: admin.userId, estateId: null, summary: 'Mensaje enviado a Marta Ruiz' });
    expect(logged?.summary).not.toContain('confidencial');

    await messages.logSent(conversation.id, message.id, { id: recipientId, role: 'C', estateIds: [], administratorId: null });
    expect(await prisma.activityLogEntry.count({ where: { subjectType: 'message', subjectId: message.id } })).toBe(1);

    await prisma.activityLogEntry.deleteMany({ where: { subjectType: 'message', subjectId: message.id } });
    await prisma.directMessage.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.directMessageParticipant.deleteMany({ where: { conversationId: conversation.id } });
    await prisma.conversation.delete({ where: { id: conversation.id } });
    await prisma.user.delete({ where: { id: recipientId } });
  });
});
