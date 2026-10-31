import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AccountingService } from '../accounting/accounting.service';
import type { LedgerQueryService } from '../ledger/ledger-query.service';
import { EstateDashboardService } from './estate-dashboard.service';

/**
 * «Próxima junta» del panel del gestor: vigente hasta que pasa la segunda convocatoria, igual que
 * en el panel del propietario. Sin base de datos.
 */
const manager = {
  id: 'b',
  role: 'B',
  estateIds: ['e1'],
  administratorId: 'adm',
} as unknown as AuthenticatedUser;
const now = new Date('2026-10-20T10:10:00Z');

describe('EstateDashboardService · próxima junta', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());

  // Primera convocatoria ya pasada (10:00), segunda a las 10:30: sigue vigente.
  const convened = {
    id: 'm1',
    title: 'Junta ordinaria',
    type: 'ordinaria',
    scheduledAt1: new Date('2026-10-20T10:00:00Z'),
    scheduledAt2: new Date('2026-10-20T10:30:00Z'),
  };
  const later = {
    id: 'm2',
    title: 'Otra junta',
    type: 'ordinaria',
    scheduledAt1: new Date('2026-11-05T10:00:00Z'),
    scheduledAt2: new Date('2026-11-05T10:30:00Z'),
  };

  function build(meetings: unknown[]) {
    const prisma = {
      estate: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
      accountingReceipt: { groupBy: jest.fn().mockResolvedValue([]) },
      issue: { count: jest.fn().mockResolvedValue(0) },
      // Dos consultas: primera convocatoria por delante (scheduledAt1 gte) y entre la primera y la segunda (scheduledAt1 lt).
      meeting: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }) =>
            Promise.resolve(
              (meetings as { scheduledAt1: Date; scheduledAt2: Date }[]).filter(
                (m) =>
                  'gte' in where.scheduledAt1
                    ? m.scheduledAt1 >= where.scheduledAt1.gte
                    : m.scheduledAt1 < where.scheduledAt1.lt &&
                      m.scheduledAt2 >= where.scheduledAt2.gte,
              ),
            ),
          ),
      },
      regulatoryInspection: { findMany: jest.fn().mockResolvedValue([]) },
      supplierContract: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const accounting = {
      summary: jest.fn().mockResolvedValue({
        units: 1,
        balance: { toNumber: () => 0 },
        delinquency: { toNumber: () => 0 },
      }),
    } as unknown as AccountingService;
    return {
      prisma,
      service: new EstateDashboardService(
        prisma,
        accounting,
        new EstateAccessService(),
        {} as LedgerQueryService,
      ),
    };
  }

  it('summary: una junta entre su primera y su segunda convocatoria sigue siendo la próxima', async () => {
    const { prisma, service } = build([later, convened]);
    const summary = await service.summary('e1', manager);
    expect(summary.nextMeeting).toEqual({
      id: 'm1',
      title: 'Junta ordinaria',
      type: 'ordinaria',
      scheduledAt: '2026-10-20T10:30:00.000Z',
    });
    // Acotado: una consulta por tipo de convocatoria, con límite, en vez de traer todas las juntas.
    const calls = (prisma.meeting.findMany as jest.Mock).mock.calls.map(
      ([args]) => args,
    );
    expect(calls).toHaveLength(2);
    expect(calls.every((args) => args.take === 1)).toBe(true);
  });

  it('milestones: las consultas van acotadas por el horizonte y por el límite', async () => {
    const { prisma, service } = build([]);
    await service.milestones('e1', manager);
    const calls = (prisma.meeting.findMany as jest.Mock).mock.calls.map(
      ([args]) => args,
    );
    expect(calls).toHaveLength(2);
    expect(calls.every((args) => args.take === 6)).toBe(true);
    expect(calls[0].where.scheduledAt1.lte).toBeInstanceOf(Date);
    expect(calls[1].where.scheduledAt2.lte).toBeInstanceOf(Date);
  });

  it('milestones: la junta vigente aparece con la fecha de su segunda convocatoria', async () => {
    const { service } = build([later, convened]);
    const { items } = await service.milestones('e1', manager);
    expect(
      items.filter((i) => i.kind === 'meeting').map((i) => [i.key, i.date]),
    ).toEqual([
      ['meeting:m1', '2026-10-20T10:30:00.000Z'],
      ['meeting:m2', '2026-11-05T10:00:00.000Z'],
    ]);
  });

  it('summary: sin juntas vigentes no hay próxima', async () => {
    const { service } = build([]);
    expect((await service.summary('e1', manager)).nextMeeting).toBeNull();
  });
});
