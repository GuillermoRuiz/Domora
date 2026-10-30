import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from './estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Acceso a UNA propiedad concreta — a diferencia de `EstateAccessService`
 * (por finca, síncrono, solo lee el JWT), esto SIEMPRE consulta la base de
 * datos: el rol C nunca lleva `propertyIds` en el JWT, solo `estateIds`
 * (todas las fincas donde tiene alguna propiedad), así que comprobar solo
 * por finca dejaría ver la propiedad de un vecino con solo compartir finca
 * (hallazgo real, corregido en `PropertiesService.findRawById` — ver
 * memoria `discovery_property_scope_leak.md`). Único sitio del código que
 * decide esto; cada módulo que necesite "esta propiedad es del usuario que
 * pregunta" pasa por aquí en vez de reimplementar el criterio.
 */
@Injectable()
export class PropertyAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  /**
   * Rol A y rol B: por finca, como siempre. Rol C: por PROPIEDAD — cuenta
   * ser el creador (`primaryUserId`, alta de autoservicio, incluso con la
   * adhesión todavía pendiente) o tener una `PropertyMembership` vinculada
   * (altas hechas por la gestora, que nunca rellenan `primaryUserId`).
   */
  async assertAccess(
    property: {
      id: string;
      estateId: string | null;
      primaryUserId?: string | null;
    },
    user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role !== 'C') {
      this.estateAccess.assertAccess(property.estateId, user);
      return;
    }
    if (!(await this.ownsOrIsLinked(property, user))) {
      throw new ForbiddenException(
        'No tienes permiso para acceder a esta propiedad.',
      );
    }
  }

  /**
   * Lo mismo que `assertAccess`, sin lanzar: para quien tiene que responder igual que si la propiedad no existiera (una
   * incidencia ajena no debe distinguirse de una inexistente). Es el MISMO criterio, no otro.
   */
  async canAccess(
    property: {
      id: string;
      estateId: string | null;
      primaryUserId?: string | null;
    },
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (user.role !== 'C')
      return this.estateAccess.canAccess(property.estateId, user);
    return this.ownsOrIsLinked(property, user);
  }

  /**
   * El filtro de los listados con el mismo criterio que `assertAccess` para el rol C (titular que la creó, o membresía
   * vinculada y no revocada). `null` para A y B: van por finca, como siempre, y no se restringen por propiedad.
   */
  ownedPropertiesWhere(
    user: AuthenticatedUser,
  ): Prisma.PropertyWhereInput | null {
    if (user.role !== 'C') return null;
    return {
      OR: [
        { primaryUserId: user.id },
        {
          memberships: {
            some: { userId: user.id, status: 'linked', revokedAt: null },
          },
        },
      ],
    };
  }

  /**
   * «Miembro activo de esta comunidad»: el criterio de las incidencias de zona común, que no pertenecen a ninguna propiedad. Rol C:
   * SIEMPRE en la base de datos (nunca el `estateIds` del JWT, que no se entera de una baja hasta renovar la sesión): una
   * `PropertyMembership` vinculada y no revocada de una propiedad NO dada de baja de ESA finca. A y B van por finca, como siempre.
   * Falla cerrado: sin finca no es miembro de nada.
   */
  async isActiveMember(
    estateId: string | null | undefined,
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (!estateId) return false;
    if (user.role !== 'C') return this.estateAccess.canAccess(estateId, user);
    const membership = await this.prisma.propertyMembership.findFirst({
      where: {
        userId: user.id,
        status: 'linked',
        revokedAt: null,
        property: { estateId, deletedAt: null },
      },
      select: { id: true },
    });
    return !!membership;
  }

  /**
   * Las comunidades de las que el rol C es miembro ACTIVO (misma regla que `isActiveMember`, también en la base de datos): las que
   * puede listar en «Incidencias». Una propiedad sin finca no cuenta. A y B no pasan por aquí.
   */
  async activeEstateIds(user: AuthenticatedUser): Promise<string[]> {
    if (user.role !== 'C') return [];
    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        userId: user.id,
        status: 'linked',
        revokedAt: null,
        property: { deletedAt: null, estateId: { not: null } },
      },
      select: { property: { select: { estateId: true } } },
    });
    return [
      ...new Set(
        memberships.flatMap((m) =>
          m.property.estateId ? [m.property.estateId] : [],
        ),
      ),
    ];
  }

  private async ownsOrIsLinked(
    property: { id: string; primaryUserId?: string | null },
    user: AuthenticatedUser,
  ): Promise<boolean> {
    if (property.primaryUserId === user.id) return true;
    const membership = await this.prisma.propertyMembership.findFirst({
      where: {
        propertyId: property.id,
        userId: user.id,
        status: 'linked',
        revokedAt: null,
      },
    });
    return !!membership;
  }
}
