import type { PrismaService } from '../prisma/prisma.service';
import type { CatastroFacadeService } from './catastro-facade.service';

/** Explicit, sequential backfill. No overview request calls WFS. */
export async function backfillFacades(
  prisma: Pick<PrismaService, 'estate'>,
  facade: Pick<CatastroFacadeService, 'refreshEstate'>,
  options: {
    limit: number;
    retry: boolean;
    log: (line: string) => void;
    pause?: () => Promise<void>;
  },
): Promise<{ processed: number; photos: number; errors: number }> {
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 10_000
  )
    throw new RangeError('limit must be between 1 and 10000');
  const result = { processed: 0, photos: 0, errors: 0 };
  let cursor: string | undefined;
  while (result.processed < options.limit) {
    const rows = await prisma.estate.findMany({
      where: {
        deletedAt: null,
        cadastralReference: { not: null },
        catastroFacadeUrl: null,
        ...(!options.retry ? { catastroFacadeResolvedAt: null } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, cadastralReference: true },
      orderBy: { id: 'asc' },
      take: Math.min(50, options.limit - result.processed),
    });
    if (!rows.length) break;
    for (const estate of rows) {
      try {
        const url = await facade.refreshEstate(
          estate.id,
          estate.cadastralReference,
          true,
        );
        if (url) result.photos++;
        options.log(
          `${estate.id}: ${url ? 'fachada resuelta' : 'sin URL disponible (sin foto o fallo WFS)'}`,
        );
      } catch {
        result.errors++;
        options.log(`${estate.id}: error individual; continúa el lote`);
      }
      result.processed++;
      cursor = estate.id;
      await options.pause?.();
    }
  }
  return result;
}
