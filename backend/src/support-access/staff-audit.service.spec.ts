import { StaffAuditService } from './staff-audit.service';
import type { PrismaService } from '../prisma/prisma.service';

const STAFF = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';

function build() {
  const prisma = {
    staffAuditLog: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([{ id: 'r1' }]),
      count: jest.fn().mockResolvedValue(41),
    },
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  return { prisma, service: new StaffAuditService(prisma) };
}

describe('StaffAuditService', () => {
  it('writes one row synchronously and propagates a failure', async () => {
    const { prisma, service } = build();
    const entry = {
      staffUserId: STAFF,
      administratorId: ADMIN,
      estateId: null,
      supportSessionId: null,
      action: 'read' as const,
      method: 'GET',
      route: 'estates/:estateId',
    };
    await service.record(entry);
    expect(prisma.staffAuditLog.create).toHaveBeenCalledWith({ data: entry });

    (prisma.staffAuditLog.create as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(service.record(entry)).rejects.toThrow('db down');
  });

  it('lists newest first, paged and filtered by despacho, staff and dates', async () => {
    const { prisma, service } = build();
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-31T00:00:00.000Z');
    const page = await service.list({
      administratorId: ADMIN,
      staffUserId: STAFF,
      from,
      to,
      page: 2,
      pageSize: 20,
    });
    const where = {
      administratorId: ADMIN,
      staffUserId: STAFF,
      occurredAt: { gte: from, lte: to },
    };
    expect(prisma.staffAuditLog.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 20,
    });
    expect(prisma.staffAuditLog.count).toHaveBeenCalledWith({ where });
    expect(page).toEqual({ items: [{ id: 'r1' }], total: 41, page: 2, pageSize: 20 });
  });

  it('applies no filter when none is given', async () => {
    const { prisma, service } = build();
    await service.list({ page: 1, pageSize: 50 });
    expect(prisma.staffAuditLog.count).toHaveBeenCalledWith({ where: {} });
  });
});
