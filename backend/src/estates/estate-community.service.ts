import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { issuesOfEstate } from '../issues/issue-estate';
import { ownerKey } from './estate-overview.service';

/** Cómo están las zonas comunes a ojos del propietario: solo una etiqueta, nunca la lista de instalaciones. */
export type CommonAreasState = 'sin_datos' | 'buen_estado' | 'en_mantenimiento' | 'requiere_atencion';

export interface CommunitySummary {
  id: string;
  name: string;
  type: string;
  /** Calle y número. */
  address: string;
  postalCode: string | null;
  location: string;
  province: string | null;
  description: string | null;
  /** Hay foto subida si no es null; la imagen se pide por `GET estates/:id/photo`. */
  photoUpdatedAt: Date | null;
  catastroFacadeUrl: string | null;
  indicators: {
    /** Propietarios distintos de la comunidad (mismo criterio que el panel de gestión). */
    owners: number;
    /** Incidencias activas de TODA la comunidad: solo el número, nunca su contenido. */
    activeIssues: number;
    commonAreas: CommonAreasState;
  };
}

/**
 * Resumen de la comunidad para el propietario («Mi comunidad»). PRIVACIDAD: el
 * rol C solo recibe datos de presentación de la finca y tres indicadores
 * agregados; ni nombres de otros propietarios, ni incidencias, ni instalaciones.
 */
@Injectable()
export class EstateCommunityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  async getSummary(estateId: string, user: AuthenticatedUser): Promise<CommunitySummary> {
    this.estateAccess.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: {
        id: true,
        name: true,
        type: true,
        address: true,
        streetNumber: true,
        postalCode: true,
        location: true,
        province: true,
        description: true,
        photoUpdatedAt: true,
        catastroFacadeUrl: true,
      },
    });
    if (!estate) throw new NotFoundException('Finca no encontrada.');

    // Mismo criterio que el panel de gestión: las propiedades borradas no cuentan.
    const inEstate = { estateId, deletedAt: null };
    const [memberships, external, activeIssues, assetStates] = await Promise.all([
      this.prisma.propertyMembership.findMany({
        where: {
          roleType: 'Propietario',
          status: 'linked',
          revokedAt: null,
          user: { deletedAt: null },
          property: inEstate,
        },
        select: { userId: true, user: { select: { taxIdCountry: true, taxId: true } } },
      }),
      this.prisma.externalOwner.findMany({
        where: { promotedToUserId: null, property: inEstate },
        select: { id: true, taxIdCountry: true, taxId: true },
      }),
      this.prisma.issue.count({
        where: { deletedAt: null, status: { in: ACTIVE_ISSUE_STATUSES }, ...issuesOfEstate(estateId) },
      }),
      this.prisma.asset.groupBy({ by: ['operationalStatus'], where: { estateId }, _count: { _all: true } }),
    ]);

    const owners = new Set<string>();
    for (const m of memberships) owners.add(ownerKey(m.user, `user:${m.userId}`));
    for (const o of external) owners.add(ownerKey(o, `external:${o.id}`));

    const has = (status: string) => assetStates.some((a) => a.operationalStatus === status);
    const commonAreas: CommonAreasState =
      assetStates.length === 0
        ? 'sin_datos'
        : has('fuera_de_servicio')
          ? 'requiere_atencion'
          : has('en_mantenimiento')
            ? 'en_mantenimiento'
            : 'buen_estado';

    const { streetNumber, ...rest } = estate;
    return {
      ...rest,
      address: [estate.address, streetNumber].filter(Boolean).join(', '),
      indicators: { owners: owners.size, activeIssues, commonAreas },
    };
  }
}
