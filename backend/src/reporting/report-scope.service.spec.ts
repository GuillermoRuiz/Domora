import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { ReportScopeService } from './report-scope.service';

describe('ReportScopeService', () => {
  const user = {
    id: 'b1',
    role: 'B' as const,
    administratorId: 'stale',
    estateIds: ['foreign'],
  };
  const prisma = {
    user: { findFirst: jest.fn() },
    estate: { findMany: jest.fn() },
  };
  const service = new ReportScopeService(prisma as unknown as PrismaService);
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findFirst.mockResolvedValue({
      id: 'b1',
      role: 'B',
      administratorId: 'a1',
      administrator: { deletedAt: null, status: 'Activa' },
    });
    prisma.estate.findMany.mockResolvedValue([{ id: 'own', name: 'Propia' }]);
  });
  it('uses the current DB tenant instead of stale JWT scope', async () => {
    const result = await service.resolve(user, { scopeMode: 'all' });
    expect(result.administratorId).toBe('a1');
    expect(result.user.estateIds).toEqual(['own']);
    expect(prisma.estate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { administratorId: 'a1', deletedAt: null },
      }),
    );
  });
  it.each([['foreign'], ['own', 'foreign'], ['missing']])(
    'rejects the whole unauthorized selection %j',
    async (...ids) => {
      await expect(
        service.resolve(user, { scopeMode: 'selected', estateIds: ids }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('rejects a revoked or deleted current user', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.resolve(user, { scopeMode: 'all' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects platform and owner roles even with a valid JWT', async () => {
    await expect(
      service.resolve({ ...user, role: 'A' }, { scopeMode: 'all' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.resolve({ ...user, role: 'C' }, { scopeMode: 'all' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('listEstates trae la dirección con una sola consulta de comunidades; resolve sigue pidiendo solo id y nombre', async () => {
    const row = { id: 'own', name: 'Propia', address: 'Calle Sol', streetNumber: '1', location: 'Madrid' };
    prisma.estate.findMany.mockResolvedValueOnce([row]);
    expect(await service.listEstates(user)).toEqual([row]);
    expect(prisma.estate.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.estate.findMany.mock.calls[0][0].select).toEqual({ id: true, name: true, address: true, streetNumber: true, location: true });

    prisma.estate.findMany.mockClear();
    const scope = await service.resolve(user, { scopeMode: 'all' });
    expect(prisma.estate.findMany.mock.calls[0][0].select).toEqual({ id: true, name: true });
    expect(scope.estates).toEqual([{ id: 'own', name: 'Propia' }]);
  });
});
