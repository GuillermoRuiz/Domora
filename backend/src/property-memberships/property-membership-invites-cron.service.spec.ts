import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PropertyMembershipInvitesCronService } from './property-membership-invites-cron.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real, mismo criterio que
 * `meetings-notifications-cron.service.spec.ts`: la ventana de "≤2 días de
 * la caducidad" y la guarda de "ya avisado hoy" son aritmética de fechas
 * sobre columnas Timestamptz reales, justo lo que un mock no verifica.
 *
 * El cron recorre TODAS las invitaciones de la BD (no está acotado a una
 * finca), así que las aserciones filtran por el email único de cada test en
 * vez de afirmar "no se llamó nunca" — otros specs corriendo en paralelo
 * pueden tener invitaciones propias en la misma BD.
 */
const prisma = createPrismaClient();

const CIF = 'TESTINV-CRON-1';
const DAY_MS = 24 * 60 * 60 * 1000;

let administratorId: string;
let estateId: string;
let propertyId: string;
let managerId: string;

function uniqueEmail(tag: string): string {
  return `invitado-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}

async function createInvite(overrides: {
  inviteeEmail: string;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
  reminderSentAt?: Date;
}) {
  return prisma.propertyMembershipInvite.create({
    data: {
      propertyId,
      roleType: 'Inquilino',
      tokenHash: `hash-${Math.random().toString(36).slice(2)}-${Date.now()}`,
      createdByUserId: managerId,
      ...overrides,
    },
  });
}

function sendsTo(send: jest.Mock, email: string) {
  return send.mock.calls.filter(([to]) => to === email);
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: { name: 'Gestora de prueba (invites cron)', cif: CIF, plan: 'BASE', tier: 'basic', usersMax: 5, status: 'Activa' },
  });
  administratorId = admin.id;

  const estate = await prisma.estate.create({
    data: { administratorId, name: 'Finca de prueba — invites cron', type: 'Edificio', address: 'Calle Falsa 13', location: 'Madrid' },
  });
  estateId = estate.id;

  const property = await prisma.property.create({
    data: {
      estateId,
      type: 'Piso',
      status: 'Ocupado',
      viaType: 'Calle',
      viaName: 'Falsa',
      streetNumber: '13',
      floor: '2',
      door: 'B',
      quotaMonthly: '50.00',
    },
  });
  propertyId = property.id;

  const manager = await prisma.user.create({
    data: { email: `manager-invites-cron-${Date.now()}@test.local`, passwordHash: 'x', fullName: 'Gestora', role: 'B', administratorId },
  });
  managerId = manager.id;
});

afterAll(async () => {
  await prisma.propertyMembershipInvite.deleteMany({ where: { propertyId } });
  await prisma.property.delete({ where: { id: propertyId } });
  await prisma.user.deleteMany({ where: { administratorId } });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

function buildCron(send: jest.Mock) {
  const mail = { sendMembershipInviteReminder: send } as unknown as MailService;
  return new PropertyMembershipInvitesCronService(prisma as unknown as PrismaService, mail);
}

describe('PropertyMembershipInvitesCronService', () => {
  it('recién creada (caduca en 5 días, fuera de la ventana de 2), NO avisa todavía', async () => {
    const email = uniqueEmail('fresca');
    await createInvite({ inviteeEmail: email, expiresAt: new Date(Date.now() + 5 * DAY_MS) });
    const send = jest.fn().mockResolvedValue(undefined);

    await buildCron(send).run();

    expect(sendsTo(send, email)).toHaveLength(0);
  });

  it('a 2 días de caducar, avisa al invitado con la dirección y marca reminderSentAt', async () => {
    const email = uniqueEmail('por-caducar');
    const invite = await createInvite({ inviteeEmail: email, expiresAt: new Date(Date.now() + 2 * DAY_MS) });
    const send = jest.fn().mockResolvedValue(undefined);

    await buildCron(send).run();

    expect(sendsTo(send, email)).toEqual([[email, 'Inquilino', 'Calle Falsa 13 2º B', 2]]);
    const updated = await prisma.propertyMembershipInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(updated.reminderSentAt).not.toBeNull();
  });

  it('ya avisado hoy, no reenvía (guarda contra réplicas/cron corriendo dos veces)', async () => {
    const email = uniqueEmail('ya-avisada');
    await createInvite({
      inviteeEmail: email,
      expiresAt: new Date(Date.now() + DAY_MS),
      reminderSentAt: new Date(),
    });
    const send = jest.fn().mockResolvedValue(undefined);

    await buildCron(send).run();

    expect(sendsTo(send, email)).toHaveLength(0);
  });

  it('correr el cron dos veces seguidas solo avisa una vez', async () => {
    const email = uniqueEmail('doble-corrida');
    await createInvite({ inviteeEmail: email, expiresAt: new Date(Date.now() + DAY_MS) });
    const send = jest.fn().mockResolvedValue(undefined);
    const cron = buildCron(send);

    await cron.run();
    await cron.run();

    expect(sendsTo(send, email)).toHaveLength(1);
  });

  it('ya caducada, no avisa (reenviarla es decisión de la gestora, no del cron)', async () => {
    const email = uniqueEmail('caducada');
    await createInvite({ inviteeEmail: email, expiresAt: new Date(Date.now() - DAY_MS) });
    const send = jest.fn().mockResolvedValue(undefined);

    await buildCron(send).run();

    expect(sendsTo(send, email)).toHaveLength(0);
  });

  it('ya canjeada o revocada, no avisa aunque esté dentro de la ventana', async () => {
    const usedEmail = uniqueEmail('canjeada');
    const revokedEmail = uniqueEmail('revocada');
    await createInvite({ inviteeEmail: usedEmail, expiresAt: new Date(Date.now() + DAY_MS), usedAt: new Date() });
    await createInvite({ inviteeEmail: revokedEmail, expiresAt: new Date(Date.now() + DAY_MS), revokedAt: new Date() });
    const send = jest.fn().mockResolvedValue(undefined);

    await buildCron(send).run();

    expect(sendsTo(send, usedEmail)).toHaveLength(0);
    expect(sendsTo(send, revokedEmail)).toHaveLength(0);
  });

  it('un fallo de envío a un invitado no impide avisar a los demás', async () => {
    const failingEmail = uniqueEmail('falla');
    const okEmail = uniqueEmail('ok');
    await createInvite({ inviteeEmail: failingEmail, expiresAt: new Date(Date.now() + DAY_MS) });
    await createInvite({ inviteeEmail: okEmail, expiresAt: new Date(Date.now() + DAY_MS) });
    const send = jest.fn().mockImplementation((to: string) =>
      to === failingEmail ? Promise.reject(new Error('SMTP caído')) : Promise.resolve(),
    );

    await buildCron(send).run();

    expect(sendsTo(send, okEmail)).toHaveLength(1);
  });
});
