import { Prisma } from '../../prisma/client';
import {
  agingBucket,
  ownerIdentity,
  resolutionDurationDays,
} from './report-rules';

describe('report domain boundaries', () => {
  const cut = new Date('2026-10-15T00:00:00Z');
  it.each([
    [10, 'under30'],
    [29, 'under30'],
    [30, '30to60'],
    [45, '30to60'],
    [60, '30to60'],
    [61, '61to90'],
    [75, '61to90'],
    [90, '61to90'],
    [91, 'over90'],
    [120, 'over90'],
    [-1, 'notDue'],
    [0, 'notDue'],
  ])('classifies %i days', (days, expected) => {
    const due = new Date(cut.getTime() - Number(days) * 86400000);
    expect(agingBucket(due, cut, new Prisma.Decimal(12))).toBe(expected);
  });
  it('keeps missing due dates separate and ignores zero/cancelled balances', () => {
    expect(agingBucket(null, cut, new Prisma.Decimal(5))).toBe('unknown');
    expect(agingBucket(cut, cut, new Prisma.Decimal(0))).toBeNull();
  });
  it('classifies partial and returned debt using the remaining balance only', () => {
    const due = new Date('2026-08-31');
    expect(agingBucket(due, cut, new Prisma.Decimal('25.10'))).toBe('30to60');
    expect(agingBucket(due, cut, new Prisma.Decimal('100.00'))).toBe('30to60');
    expect(agingBucket(due, cut, new Prisma.Decimal('-10'))).toBeNull();
  });
  it('never merges namesakes or unknown tax identifiers', () => {
    expect(ownerIdentity({ id: 'a', name: 'Igual' })).not.toBe(
      ownerIdentity({ id: 'b', name: 'Igual' }),
    );
    expect(
      ownerIdentity({ id: 'a', taxCountry: 'ES', taxId: '12345678Z' }),
    ).toBe(ownerIdentity({ id: 'b', taxCountry: 'ES', taxId: '12345678Z' }));
    expect(
      ownerIdentity({ id: 'a', taxCountry: 'ES', taxId: '12345678A' }),
    ).not.toBe(
      ownerIdentity({ id: 'b', taxCountry: 'ES', taxId: '12345678A' }),
    );
    expect(ownerIdentity({ id: 'a', userId: 'u' })).toBe(
      ownerIdentity({ id: 'b', userId: 'u' }),
    );
  });
  it('uses the final resolution after reopening, never updatedAt', () => {
    const opened = new Date('2026-10-01');
    expect(
      resolutionDurationDays(opened, [
        {
          date: new Date('2026-10-02'),
          fromStatus: 'Abierta',
          toStatus: 'Resuelta',
        },
        {
          date: new Date('2026-10-03'),
          fromStatus: 'Resuelta',
          toStatus: 'Abierta',
        },
        {
          date: new Date('2026-10-05'),
          fromStatus: 'PendienteProveedor',
          toStatus: 'Resuelta',
        },
      ]),
    ).toBe(4);
    expect(
      resolutionDurationDays(opened, [
        {
          date: new Date('2026-10-02'),
          fromStatus: 'Abierta',
          toStatus: 'Cerrada',
        },
      ]),
    ).toBe(1);
    expect(resolutionDurationDays(opened, [])).toBeNull();
    expect(
      resolutionDurationDays(opened, [
        {
          date: new Date('2026-10-02'),
          fromStatus: 'Abierta',
          toStatus: 'Resuelta',
        },
        {
          date: new Date('2026-10-03'),
          fromStatus: 'Resuelta',
          toStatus: 'Abierta',
        },
      ]),
    ).toBeNull();
  });
});
