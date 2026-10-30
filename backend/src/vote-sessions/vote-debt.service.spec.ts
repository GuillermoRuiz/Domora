import { Prisma } from '../prisma/client';
import { VoteDebtService } from './vote-debt.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('VoteDebtService', () => {
  const at = new Date('2026-10-21T10:00:00Z');

  function setup(rows: { propertyId: string; sum: string | null }[]) {
    const groupBy = jest.fn().mockResolvedValue(rows.map((row) => ({ propertyId: row.propertyId, _sum: { outstanding: row.sum == null ? null : new Prisma.Decimal(row.sum) } })));
    const prisma = { accountingReceipt: { groupBy } } as unknown as PrismaService;
    return { service: new VoteDebtService(prisma), groupBy };
  }

  it('suma lo pendiente de los recibos abiertos y vencidos de cada propiedad', async () => {
    const { service, groupBy } = setup([{ propertyId: 'p1', sum: '350.50' }, { propertyId: 'p2', sum: '12' }]);
    const debts = await service.overdueByProperty('estate-1', undefined, at);
    expect(debts).toEqual(new Map([['p1', 350.5], ['p2', 12]]));
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          estateId: 'estate-1',
          status: { in: ['Pendiente', 'Parcial', 'Devuelto'] },
          outstanding: { gt: 0 },
          OR: [{ dueDate: null }, { dueDate: { lte: at } }],
        }),
      }),
    );
  });

  it('acota a las propiedades pedidas', async () => {
    const { service, groupBy } = setup([]);
    await service.overdueByProperty('estate-1', ['p1'], at);
    expect(groupBy.mock.calls[0][0].where.propertyId).toEqual({ in: ['p1'] });
  });

  it('una propiedad sin importe pendiente no cuenta como deudora', async () => {
    const { service } = setup([{ propertyId: 'p1', sum: null }, { propertyId: 'p2', sum: '0' }]);
    expect((await service.overdueByProperty('estate-1', undefined, at)).size).toBe(0);
  });
});
