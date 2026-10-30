import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

@Injectable()
export class UserRepresentationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Una representación (apoderamiento) es un dato personal y de relación
   * jurídica: solo la puede consultar el propio interesado. El rol A
   * (plataforma) mantiene su bypass habitual.
   *
   * Antes no había ninguna comprobación — el `userId` llegaba de la ruta y
   * se consultaba tal cual, así que cualquier usuario autenticado podía
   * reconstruir el grafo de apoderamientos de toda la plataforma iterando
   * UUIDs. Si en el futuro el rol B necesita consultarlos para validar una
   * actuación en junta, hay que añadirlo de forma explícita y acotado a sus
   * fincas (`grantedEstateId` ∈ user.estateIds), no abriendo esto del todo.
   */
  private assertCanQuery(userId: string, user: AuthenticatedUser): void {
    if (user.role === 'A') return;
    if (user.id !== userId) {
      throw new ForbiddenException(
        'Solo puedes consultar tus propias representaciones.',
      );
    }
  }

  /**
   * Representaciones vigentes (activas y dentro de su rango de validez) en
   * las que `userId` participa, como representante o como representado.
   * Réplica de `DataService.listActiveRepresentationsFor`.
   */
  async listActiveFor(
    userId: string,
    user: AuthenticatedUser,
    at: Date = new Date(),
  ) {
    this.assertCanQuery(userId, user);
    return this.prisma.userRepresentation.findMany({
      where: {
        active: true,
        validFrom: { lte: at },
        AND: [
          {
            OR: [
              { representativeUserId: userId },
              { representedUserId: userId },
            ],
          },
          { OR: [{ validUntil: null }, { validUntil: { gte: at } }] },
        ],
      },
    });
  }

  /**
   * ¿Puede `representativeUserId` actuar en nombre de `representedUserId`
   * dentro del alcance dado? Una representación con `grantedEstateId`/
   * `grantedPropertyId` en null es global (aplica a cualquier finca/
   * propiedad); si no, debe coincidir exactamente con el alcance solicitado.
   */
  async canActOnBehalfOf(
    representativeUserId: string,
    representedUserId: string,
    user: AuthenticatedUser,
    scope: { estateId?: string; propertyId?: string } = {},
    at: Date = new Date(),
  ): Promise<boolean> {
    // Solo el propio representante puede preguntar por sus poderes: la
    // respuesta revela si existe un apoderamiento entre dos personas.
    this.assertCanQuery(representativeUserId, user);
    const representations = await this.prisma.userRepresentation.findMany({
      where: {
        representativeUserId,
        representedUserId,
        active: true,
        validFrom: { lte: at },
      },
    });
    return representations.some((rep) => {
      if (rep.validUntil && rep.validUntil < at) return false;
      const estateMatches =
        !rep.grantedEstateId || rep.grantedEstateId === scope.estateId;
      const propertyMatches =
        !rep.grantedPropertyId || rep.grantedPropertyId === scope.propertyId;
      return estateMatches && propertyMatches;
    });
  }
}
