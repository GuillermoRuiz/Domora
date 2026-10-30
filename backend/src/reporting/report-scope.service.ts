import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import type { ReportInput, ReportScope } from './reporting.types';

export interface AccessibleEstate {
  id: string;
  name: string;
  address: string;
  streetNumber: string | null;
  location: string;
}

/** Reporting never inherits tenant access from stale JWT estate claims. */
@Injectable()
export class ReportScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Comunidades de la gestora del usuario, con la dirección para el selector (una sola consulta de comunidades). */
  async listEstates(actor: AuthenticatedUser): Promise<AccessibleEstate[]> {
    const { administratorId } = await this.currentTenant(actor);
    return this.prisma.estate.findMany({
      where: { administratorId, deletedAt: null },
      select: { id: true, name: true, address: true, streetNumber: true, location: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Gestora vigente del usuario en base de datos (no la de los claims del JWT, que pueden estar obsoletos). */
  private async currentTenant(
    actor: AuthenticatedUser,
  ): Promise<{ administratorId: string; userId: string }> {
    if (actor.role !== 'B')
      throw new ForbiddenException(
        'Informes está disponible para el equipo de la gestora.',
      );
    const current = await this.prisma.user.findFirst({
      where: { id: actor.id, role: 'B', deletedAt: null },
      select: {
        id: true,
        role: true,
        administratorId: true,
        administrator: { select: { deletedAt: true, status: true } },
      },
    });
    if (
      !current?.administratorId ||
      !current.administrator ||
      current.administrator.deletedAt ||
      current.administrator.status === 'Bloqueada'
    ) {
      throw new ForbiddenException('No tienes acceso a esta gestora.');
    }
    return { administratorId: current.administratorId, userId: current.id };
  }

  async resolve(
    actor: AuthenticatedUser,
    input: Pick<ReportInput, 'scopeMode' | 'estateIds'>,
  ): Promise<ReportScope> {
    const current = await this.currentTenant(actor);
    const accessible = await this.prisma.estate.findMany({
      where: { administratorId: current.administratorId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    if (input.scopeMode === 'all' && input.estateIds?.length)
      throw new BadRequestException(
        'El ámbito de todas las comunidades no acepta una selección adicional.',
      );
    if (input.scopeMode === 'selected' && !input.estateIds?.length)
      throw new BadRequestException('Selecciona al menos una comunidad.');
    const requested = new Set(input.estateIds ?? []);
    const allowed = new Set(accessible.map((e) => e.id));
    // Unknown IDs and foreign IDs deliberately produce the same response, with no partial result.
    if ([...requested].some((id) => !allowed.has(id)))
      throw new ForbiddenException(
        'La selección contiene comunidades no accesibles.',
      );
    const estates =
      input.scopeMode === 'all'
        ? accessible
        : accessible.filter((e) => requested.has(e.id));
    return {
      administratorId: current.administratorId,
      user: {
        id: current.userId,
        role: 'B',
        administratorId: current.administratorId,
        estateIds: accessible.map((e) => e.id),
      },
      estates,
      estateIds: estates.map((e) => e.id),
      mode: input.scopeMode,
    };
  }
}
