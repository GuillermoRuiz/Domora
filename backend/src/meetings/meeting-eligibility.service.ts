import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Aislado de `MeetingsService` (Fase 2.1) para que el motor de votación
 * (`vote-sessions/`) pueda resolver "quién puede actuar por esta propiedad
 * en esta junta" sin importar la superficie completa de `MeetingsService`
 * ni duplicar la regla — antes vivía como métodos privados ahí, usados por
 * la asistencia autodeclarada, el pase de lista y la creación de
 * delegaciones. Misma lógica, sin cambios de comportamiento.
 */
@Injectable()
export class MeetingEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Un usuario elegible (miembro vinculado de la propiedad, o representante
   * de una delegación de voto activa para esta junta) para asistir/votar
   * por `propertyId`.
   */
  async listEligibleAttendeeIds(
    meetingId: string,
    propertyId: string,
  ): Promise<{ userId: string; name: string; kind: 'own' | 'delegated' }[]> {
    const [memberships, delegations] = await Promise.all([
      this.prisma.propertyMembership.findMany({
        where: {
          propertyId,
          status: 'linked',
          roleType: { in: ['Propietario', 'Representante'] },
        },
        include: { user: { select: { id: true, fullName: true } } },
      }),
      this.prisma.meetingVoteDelegation.findMany({
        // Un representante externo (sin cuenta) no puede asistir ni votar en Domora.
        where: {
          meetingId,
          propertyId,
          revokedAt: null,
          representativeUserId: { not: null },
        },
        include: {
          representativeUser: { select: { id: true, fullName: true } },
        },
      }),
    ]);
    const own = memberships.map((m) => ({
      userId: m.user.id,
      name: m.user.fullName,
      kind: 'own' as const,
    }));
    const delegated = delegations.flatMap((d) =>
      d.representativeUser
        ? [
            {
              userId: d.representativeUser.id,
              name: d.representativeUser.fullName,
              kind: 'delegated' as const,
            },
          ]
        : [],
    );
    // Dedupe: si la propia gestora u otro usuario aparece por ambas vías.
    const byUserId = new Map<
      string,
      { userId: string; name: string; kind: 'own' | 'delegated' }
    >(own.map((e) => [e.userId, e]));
    for (const e of delegated)
      if (!byUserId.has(e.userId)) byUserId.set(e.userId, e);
    return [...byUserId.values()];
  }

  /**
   * Titulares vinculados (mismo criterio que `own` en `listEligibleAttendeeIds`) de todas las
   * propiedades de la finca, de una vez: el pase de lista los muestra por nombre sin pedirlos
   * propiedad a propiedad. Solo trae propiedades que tengan al menos uno.
   */
  async listHoldersByEstate(
    estateId: string,
  ): Promise<
    { propertyId: string; holders: { userId: string; name: string }[] }[]
  > {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: {
        property: { estateId },
        status: 'linked',
        roleType: { in: ['Propietario', 'Representante'] },
      },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: [{ roleType: 'asc' }, { linkedAt: 'asc' }],
    });
    const byProperty = new Map<
      string,
      Map<string, { userId: string; name: string }>
    >();
    for (const m of memberships) {
      const holders =
        byProperty.get(m.propertyId) ??
        new Map<string, { userId: string; name: string }>();
      if (!holders.has(m.user.id))
        holders.set(m.user.id, { userId: m.user.id, name: m.user.fullName });
      byProperty.set(m.propertyId, holders);
    }
    return [...byProperty].map(([propertyId, holders]) => ({
      propertyId,
      holders: [...holders.values()],
    }));
  }

  async assertEligibleForProperty(
    meetingId: string,
    propertyId: string,
    userId: string,
  ): Promise<void> {
    const eligible = await this.listEligibleAttendeeIds(meetingId, propertyId);
    if (!eligible.some((e) => e.userId === userId)) {
      throw new ForbiddenException(
        `No tienes vínculo con la propiedad ${propertyId} ni una delegación de voto vigente para esta junta.`,
      );
    }
  }
}
