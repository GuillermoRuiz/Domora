import type { PrismaService } from '../prisma/prisma.service';
import { CommunityFinanceService } from './community-finance.service';

const AT = new Date('2026-10-03T10:00:00Z');
interface Summary {
  ejercicio: number;
  saldo_total_de_tesoreria: string | null;
  gasto_total_del_año: string;
  gastos_por_partida: {
    partida: string;
    presupuesto_anual: string | null;
    diferencia_con_presupuesto_pct: number | null;
  }[];
  ingresos_por_partida: { partida: string }[];
}

function build(opts: { empty?: boolean } = {}) {
  const groupBy = jest
    .fn()
    .mockImplementation(
      (args: {
        where: { account: { nature: string }; date: { gte: Date } };
      }) => {
        if (opts.empty) return Promise.resolve([]);
        const nature = args.where.account.nature;
        const from = args.where.date.gte.toISOString();
        if (nature === 'income') {
          return Promise.resolve([
            { accountId: 'inc', _sum: { debit: '0', credit: '30000.00' } },
          ]);
        }
        const debit = from.startsWith('2026-01-01')
          ? '2000.00'
          : from >= '2026-09-04'
            ? '1450.00'
            : '1000.00';
        return Promise.resolve([
          { accountId: 'a1', _sum: { debit, credit: '0' } },
          // Grupo 64: gastos de personal, nunca deben salir.
          { accountId: 'staff', _sum: { debit: '24000.00', credit: '0' } },
        ]);
      },
    );
  const prisma = {
    journalLine: {
      groupBy,
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { debit: '5000.00', credit: '1000.00' } }),
    },
    budgetItem: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          opts.empty ? [] : [{ accountId: 'a1', budgeted: '1500.00' }],
        ),
    },
    chartAccount: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'a1', code: '623', name: 'Limpieza', shortName: null },
        { id: 'staff', code: '640', name: 'Sueldos conserje', shortName: null },
        { id: 'inc', code: '700', name: 'Cuotas ordinarias', shortName: null },
      ]),
    },
  };
  const service = new CommunityFinanceService(
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
}

describe('CommunityFinanceService', () => {
  it('devuelve cuentas agregadas por partida con presupuesto, ingresos y saldo', async () => {
    const { service } = build();
    const data = JSON.parse(
      (await service.summaryFor('e1', AT)) as string,
    ) as Summary;

    expect(data.ejercicio).toBe(2026);
    expect(data.saldo_total_de_tesoreria).toBeNull();
    expect(data.gasto_total_del_año).toContain('2000,00');
    expect(data.gastos_por_partida).toHaveLength(1);
    expect(data.gastos_por_partida[0]).toMatchObject({
      partida: 'Cuenta 623',
      diferencia_con_presupuesto_pct: 33.3,
    });
    expect(data.gastos_por_partida[0].presupuesto_anual).toContain('1500,00');
    expect(data.ingresos_por_partida[0].partida).toBe('Cuenta 700');
  });

  it('no expone gastos de personal ni ninguna dimensión personal', async () => {
    const { service, prisma } = build();
    const raw = (await service.summaryFor('e1', AT)) as string;

    expect(raw).not.toContain('Sueldos');
    expect(raw).not.toContain('conserje');
    // Solo agrupa por cuenta contable: nunca por vecino, proveedor, recibo, factura ni concepto.
    for (const [args] of prisma.journalLine.groupBy.mock.calls as unknown as [
      { by: string[] },
    ][]) {
      expect(args.by).toEqual(['accountId']);
    }
    const queried = JSON.stringify([
      prisma.journalLine.groupBy.mock.calls,
      prisma.journalLine.aggregate.mock.calls,
      prisma.budgetItem.findMany.mock.calls,
      prisma.chartAccount.findMany.mock.calls,
    ]);
    for (const personal of [
      'propertyId',
      'supplierId',
      'receiptId',
      'supplierInvoiceId',
      'concept',
    ]) {
      expect(queried).not.toContain(personal);
    }
  });

  it('toda consulta va acotada a la comunidad pedida', async () => {
    const { service, prisma } = build();
    await service.summaryFor('e9', AT);
    const queried = JSON.stringify([
      prisma.journalLine.groupBy.mock.calls,
      prisma.budgetItem.findMany.mock.calls,
      prisma.chartAccount.findMany.mock.calls,
    ]);
    expect(queried).toContain('e9');
    expect(queried).not.toContain('e1');
  });

  it('sin apuntes ni presupuesto devuelve null', async () => {
    const { service } = build({ empty: true });
    expect(await service.summaryFor('e1', AT)).toBeNull();
  });
});
