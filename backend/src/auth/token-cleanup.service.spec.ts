import { TokenCleanupService } from './token-cleanup.service';
import { PrismaService } from '../prisma/prisma.service';

/** Forma del argumento que el servicio pasa a `deleteMany`. */
interface DeleteManyArgs {
  where: {
    OR: [
      { expiresAt: { lt: Date } },
      { revokedAt?: { lt: Date }; usedAt?: { lt: Date } },
    ];
  };
}

describe('TokenCleanupService', () => {
  let service: TokenCleanupService;
  let refreshDeleteMany: jest.Mock;
  let resetDeleteMany: jest.Mock;

  /** `mock.calls` es `any[][]`; se tipa aquí para no hacer accesos sin tipo. */
  function argsOf(mock: jest.Mock): DeleteManyArgs {
    return (mock.mock.calls as unknown as DeleteManyArgs[][])[0][0];
  }

  beforeEach(() => {
    refreshDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    resetDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      refreshToken: { deleteMany: refreshDeleteMany },
      passwordResetToken: { deleteMany: resetDeleteMany },
    } as unknown as PrismaService;
    service = new TokenCleanupService(prisma);
  });

  it('purga ambas tablas de tokens', async () => {
    await service.purgeStaleTokens();
    expect(refreshDeleteMany).toHaveBeenCalledTimes(1);
    expect(resetDeleteMany).toHaveBeenCalledTimes(1);
  });

  it('respeta la ventana de retención en lugar de borrar todo lo caducado', async () => {
    const before = Date.now();
    await service.purgeStaleTokens();
    const after = Date.now();

    const cutoff = argsOf(refreshDeleteMany).where.OR[0].expiresAt.lt.getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    expect(cutoff).toBeGreaterThanOrEqual(before - sevenDays);
    expect(cutoff).toBeLessThanOrEqual(after - sevenDays);
  });

  it('nunca borra tokens todavía vigentes', async () => {
    await service.purgeStaleTokens();
    const { where } = argsOf(refreshDeleteMany);
    // Solo se borra por caducidad o revocación pasadas: nada de `revokedAt: null`.
    expect(where.OR).toHaveLength(2);
    expect(where.OR[0]).toHaveProperty('expiresAt');
    expect(where.OR[1]).toHaveProperty('revokedAt');
  });

  it('un fallo de base de datos no propaga la excepción (se reintenta al día siguiente)', async () => {
    refreshDeleteMany.mockRejectedValue(new Error('conexión caída'));
    await expect(service.purgeStaleTokens()).resolves.toBeUndefined();
  });
});
