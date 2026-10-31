import { ReceiptReminderCronService } from './receipt-reminder-cron.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';

const DAY_MS = 86_400_000;

/**
 * Unitario con Prisma mockeado (no contra Postgres real, a diferencia del
 * patrón de MeetingsNotificationsCronService.spec — acá lo que hay que
 * verificar es la aritmética de ventana de recordatorio, no un JOIN real):
 * día exacto -3, cada 7 días mientras está vencido, y el guard de "ya
 * avisado hoy".
 */
function receipt(
  overrides: Partial<{
    id: string;
    dueDate: Date;
    reminderSentAt: Date | null;
  }> = {},
) {
  return {
    id: 'receipt-1',
    no: '2026/01-001',
    status: 'Pendiente',
    ownerUserId: 'owner-1',
    propertyId: 'prop-1',
    estateId: 'estate-1',
    dueDate: new Date(),
    reminderSentAt: null,
    ...overrides,
  };
}

function daysFromToday(n: number): Date {
  return new Date(Date.now() + n * DAY_MS);
}

describe('ReceiptReminderCronService', () => {
  let findMany: jest.Mock;
  let update: jest.Mock;
  let notify: jest.Mock;
  let service: ReceiptReminderCronService;

  beforeEach(() => {
    findMany = jest.fn();
    update = jest.fn().mockResolvedValue({});
    notify = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      accountingReceipt: { findMany, update },
    } as unknown as PrismaService;
    service = new ReceiptReminderCronService(prisma, {
      notify,
    } as unknown as NotificationsService);
  });

  it('avisa exactamente 3 días antes del vencimiento', async () => {
    findMany.mockResolvedValue([receipt({ dueDate: daysFromToday(3) })]);
    await service.run();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: ['owner-1'], category: 'receipt' }),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'receipt-1' },
      data: { reminderSentAt: expect.any(Date) },
    });
  });

  it('no avisa a 2 ni a 4 días del vencimiento (solo el día exacto -3)', async () => {
    findMany.mockResolvedValue([
      receipt({ id: 'r-2', dueDate: daysFromToday(2) }),
      receipt({ id: 'r-4', dueDate: daysFromToday(4) }),
    ]);
    await service.run();
    expect(notify).not.toHaveBeenCalled();
  });

  it('vencido: avisa cada 7 días (día +7, +14…), no todos los días', async () => {
    findMany.mockResolvedValue([
      receipt({ id: 'r-7', dueDate: daysFromToday(-7) }),
      receipt({ id: 'r-14', dueDate: daysFromToday(-14) }),
      receipt({ id: 'r-3', dueDate: daysFromToday(-3) }),
      receipt({ id: 'r-10', dueDate: daysFromToday(-10) }),
    ]);
    await service.run();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('no reenvía si ya se avisó hoy (guard anti-reenvío-mismo-día)', async () => {
    findMany.mockResolvedValue([
      receipt({ dueDate: daysFromToday(3), reminderSentAt: new Date() }),
    ]);
    await service.run();
    expect(notify).not.toHaveBeenCalled();
  });

  it('un fallo al consultar la base (p. ej. un hipo de conexión) no tira el proceso — run() nunca lanza', async () => {
    findMany.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.run()).resolves.toBeUndefined();
  });
});
