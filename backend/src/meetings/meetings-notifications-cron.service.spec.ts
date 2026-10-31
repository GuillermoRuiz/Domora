import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MeetingsNotificationsCronService } from './meetings-notifications-cron.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Fase 2.4 — integración contra Postgres real, mismo patrón que
 * `meeting-quorum.service.spec.ts`: la ventana de "≤3 días del plazo" y la
 * guarda de "ya avisado hoy" son justo el tipo de aritmética de fechas que
 * un mock no verifica de verdad.
 */
const prisma = createPrismaClient();

const CIF = 'TESTGR-CRON-1';
const DAY_MS = 24 * 60 * 60 * 1000;

let administratorId: string;
let estateId: string;
let managerId: string;
let managerEmail: string;

interface Fixture {
  meetingIds: string[];
}

function emptyFixture(): Fixture {
  return { meetingIds: [] };
}

async function cleanup(fixture: Fixture): Promise<void> {
  if (fixture.meetingIds.length) {
    await prisma.meetingState.deleteMany({
      where: { meetingId: { in: fixture.meetingIds } },
    });
    await prisma.meeting.deleteMany({
      where: { id: { in: fixture.meetingIds } },
    });
  }
}

async function createMeeting(overrides: {
  celebratedAt: Date | null;
  actaSignedAt?: Date;
  actaReminderSentAt?: Date;
}) {
  const now = new Date();
  return prisma.meeting.create({
    data: {
      estateId,
      title: 'Junta de prueba — cron acta',
      type: 'ordinaria',
      status: 'celebrada',
      scheduledAt1: new Date(now.getTime() - 2 * DAY_MS),
      scheduledAt2: new Date(now.getTime() - DAY_MS),
      agenda: [],
      convokedBy: 'presidente',
      signerRole: 'presidente',
      attendeeEmails: [],
      includeJitsi: false,
      createdByUserId: managerId,
      ...overrides,
    },
  });
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: {
      name: 'Gestora de prueba (cron)',
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
      name: 'Finca de prueba — cron',
      type: 'Edificio',
      address: 'Calle Falsa 2022',
      location: 'Madrid',
    },
  });
  estateId = estate.id;

  const manager = await prisma.user.create({
    data: {
      email: `manager-cron-${Date.now()}@test.local`,
      passwordHash: 'x',
      fullName: 'Gestora',
      role: 'B',
      administratorId,
    },
  });
  managerId = manager.id;
  managerEmail = manager.email;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { administratorId } });
  await prisma.estate.delete({ where: { id: estateId } });
  await prisma.administrator.delete({ where: { id: administratorId } });
  await prisma.$disconnect();
});

describe('MeetingsNotificationsCronService', () => {
  it('recién celebrada (quedan ~9 días de plazo, fuera de la ventana de 3 días), NO avisa todavía', async () => {
    const fx = emptyFixture();
    try {
      const meeting = await createMeeting({
        celebratedAt: new Date(Date.now() - 1 * DAY_MS),
      });
      fx.meetingIds.push(meeting.id);
      const send = jest.fn().mockResolvedValue(undefined);
      const mail = { sendActaReadyToSign: send } as unknown as MailService;
      const cron = new MeetingsNotificationsCronService(
        prisma as unknown as PrismaService,
        mail,
      );

      await cron.run();

      expect(send).not.toHaveBeenCalled();
    } finally {
      await cleanup(fx);
    }
  });

  it('a 8 días de celebrada (2 días para el plazo de 10), avisa a la gestora y marca actaReminderSentAt', async () => {
    const fx = emptyFixture();
    try {
      const meeting = await createMeeting({
        celebratedAt: new Date(Date.now() - 8 * DAY_MS),
      });
      fx.meetingIds.push(meeting.id);
      const send = jest.fn().mockResolvedValue(undefined);
      const mail = { sendActaReadyToSign: send } as unknown as MailService;
      const cron = new MeetingsNotificationsCronService(
        prisma as unknown as PrismaService,
        mail,
      );

      await cron.run();

      expect(send).toHaveBeenCalledWith(
        managerEmail,
        'Junta de prueba — cron acta',
        2,
      );
      const updated = await prisma.meeting.findUniqueOrThrow({
        where: { id: meeting.id },
      });
      expect(updated.actaReminderSentAt).not.toBeNull();
    } finally {
      await cleanup(fx);
    }
  });

  it('ya avisado hoy, no reenvía (guarda contra réplicas/cron corriendo dos veces)', async () => {
    const fx = emptyFixture();
    try {
      const meeting = await createMeeting({
        celebratedAt: new Date(Date.now() - 8 * DAY_MS),
        actaReminderSentAt: new Date(),
      });
      fx.meetingIds.push(meeting.id);
      const send = jest.fn().mockResolvedValue(undefined);
      const mail = { sendActaReadyToSign: send } as unknown as MailService;
      const cron = new MeetingsNotificationsCronService(
        prisma as unknown as PrismaService,
        mail,
      );

      await cron.run();

      expect(send).not.toHaveBeenCalled();
    } finally {
      await cleanup(fx);
    }
  });

  it('acta ya firmada, no avisa aunque esté dentro de la ventana', async () => {
    const fx = emptyFixture();
    try {
      const meeting = await createMeeting({
        celebratedAt: new Date(Date.now() - 8 * DAY_MS),
        actaSignedAt: new Date(),
      });
      fx.meetingIds.push(meeting.id);
      const send = jest.fn().mockResolvedValue(undefined);
      const mail = { sendActaReadyToSign: send } as unknown as MailService;
      const cron = new MeetingsNotificationsCronService(
        prisma as unknown as PrismaService,
        mail,
      );

      await cron.run();

      expect(send).not.toHaveBeenCalled();
    } finally {
      await cleanup(fx);
    }
  });
});
