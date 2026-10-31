import { SubscriptionGraceCronService } from './subscription-grace-cron.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { BillingService } from './billing.service';

describe('SubscriptionGraceCronService', () => {
  let findMany: jest.Mock;
  let restrictForExpiredGrace: jest.Mock;
  let service: SubscriptionGraceCronService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([]);
    restrictForExpiredGrace = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      administratorSubscription: { findMany },
    } as unknown as PrismaService;
    service = new SubscriptionGraceCronService(prisma, {
      restrictForExpiredGrace,
    } as unknown as BillingService);
  });

  it('consulta por past_due + gracia vencida + gestora todavía Activa', async () => {
    await service.run();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'past_due',
          pastDueSince: { lte: expect.any(Date) },
          administrator: { status: 'Activa' },
        }),
      }),
    );
  });

  it('restringe cada gestora candidata vía BillingService.restrictForExpiredGrace', async () => {
    findMany.mockResolvedValue([
      { administratorId: 'admin-1' },
      { administratorId: 'admin-2' },
    ]);
    await service.run();
    expect(restrictForExpiredGrace).toHaveBeenCalledWith('admin-1');
    expect(restrictForExpiredGrace).toHaveBeenCalledWith('admin-2');
    expect(restrictForExpiredGrace).toHaveBeenCalledTimes(2);
  });

  it('sin candidatas, no llama a restrictForExpiredGrace', async () => {
    findMany.mockResolvedValue([]);
    await service.run();
    expect(restrictForExpiredGrace).not.toHaveBeenCalled();
  });

  it('un fallo al consultar la base no tira el proceso — run() nunca lanza', async () => {
    findMany.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.run()).resolves.toBeUndefined();
  });
});
