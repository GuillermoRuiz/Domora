import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from './usage.service';

const d = (day: string) => new Date(`${day}T00:00:00Z`);

function row(day: string, userId: string, role: 'B' | 'C', administratorId: string | null, modules: string[], requests: number) {
  return { day: d(day), userId, role, administratorId, modules, requests };
}

describe('UsageService.summary', () => {
  let findMany: jest.Mock;
  let service: UsageService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([
      row('2026-10-01', 'b1', 'B', 'adm1', ['estates', 'receipts'], 10),
      row('2026-10-01', 'b2', 'B', 'adm1', ['estates'], 2),
      row('2026-10-01', 'c1', 'C', null, ['documents'], 4),
      row('2026-10-03', 'b1', 'B', 'adm1', ['meetings', 'estates'], 5),
      row('2026-10-03', 'b3', 'B', 'adm2', ['accounting'], 1),
    ]);
    service = new UsageService({ userDailyActivity: { findMany } } as unknown as PrismaService);
  });

  it('queries only the requested days', async () => {
    await service.summary(d('2026-10-01'), d('2026-10-03'));
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { day: { gte: d('2026-10-01'), lte: d('2026-10-03') } } }),
    );
  });

  it('returns active users per day for every day of the range, by role', async () => {
    const summary = await service.summary(d('2026-10-01'), d('2026-10-03'));
    expect(summary.from).toBe('2026-10-01');
    expect(summary.to).toBe('2026-10-03');
    expect(summary.days).toEqual([
      { day: '2026-10-01', activeUsers: 3, activeB: 2, activeC: 1, requests: 16 },
      { day: '2026-10-02', activeUsers: 0, activeB: 0, activeC: 0, requests: 0 },
      { day: '2026-10-03', activeUsers: 2, activeB: 2, activeC: 0, requests: 6 },
    ]);
  });

  it('returns per despacho distinct active users, active days, requests, last activity and modules', async () => {
    const summary = await service.summary(d('2026-10-01'), d('2026-10-03'));
    expect(summary.despachos).toEqual([
      {
        administratorId: 'adm1',
        activeUsers: 2,
        activeDays: 2,
        requests: 17,
        lastActiveDay: '2026-10-03',
        modules: [
          { module: 'estates', userDays: 3 },
          { module: 'meetings', userDays: 1 },
          { module: 'receipts', userDays: 1 },
        ],
      },
      {
        administratorId: 'adm2',
        activeUsers: 1,
        activeDays: 1,
        requests: 1,
        lastActiveDay: '2026-10-03',
        modules: [{ module: 'accounting', userDays: 1 }],
      },
    ]);
  });

  it('returns platform-wide module counts (distinct users and user-days), most used first', async () => {
    const summary = await service.summary(d('2026-10-01'), d('2026-10-03'));
    expect(summary.modules).toEqual([
      { module: 'estates', users: 2, userDays: 3 },
      { module: 'accounting', users: 1, userDays: 1 },
      { module: 'documents', users: 1, userDays: 1 },
      { module: 'meetings', users: 1, userDays: 1 },
      { module: 'receipts', users: 1, userDays: 1 },
    ]);
  });

  it('rejects an inverted range or one longer than 366 days without querying', async () => {
    await expect(service.summary(d('2026-10-03'), d('2026-10-01'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.summary(d('2025-01-01'), d('2026-10-01'))).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('UsageService.firstCapturedDay', () => {
  it('returns the earliest captured day with one aggregate query', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _min: { day: d('2026-10-20') } });
    const service = new UsageService({ userDailyActivity: { aggregate } } as unknown as PrismaService);
    await expect(service.firstCapturedDay()).resolves.toEqual(d('2026-10-20'));
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledWith({ _min: { day: true } });
  });

  it('is null before anything was captured', async () => {
    const aggregate = jest.fn().mockResolvedValue({ _min: { day: null } });
    const service = new UsageService({ userDailyActivity: { aggregate } } as unknown as PrismaService);
    await expect(service.firstCapturedDay()).resolves.toBeNull();
  });
});
