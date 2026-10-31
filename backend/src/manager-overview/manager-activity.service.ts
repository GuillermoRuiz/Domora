import { Injectable } from '@nestjs/common';
import type {
  ActivitySubjectType,
  ActivityVerb,
  Prisma,
} from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveScope } from './manager-scope';

export interface ActivityItem {
  id: string;
  subjectType: ActivitySubjectType;
  verb: ActivityVerb;
  summary: string;
  /** Instante ISO. */
  occurredAt: string;
  /** `null` en los mensajes de la bandeja (una conversación no tiene finca). */
  estateId: string | null;
  estateName: string | null;
}

export interface ManagerActivity {
  items: ActivityItem[];
}

/** «Actividad reciente»: las 5 últimas acciones, sin «Ver todas» (D13). */
export const ACTIVITY_LIMIT = 5;

/**
 * Actividad reciente de la vista general: SOLO las acciones del propio gestor (cada
 * uno ve la suya). En la vista global entran también los mensajes de la bandeja, que
 * no pertenecen a ninguna finca; con una finca elegida solo salen los de esa finca.
 */
@Injectable()
export class ManagerActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: EstateAccessService,
  ) {}

  async activity(
    user: AuthenticatedUser,
    estateId?: string,
  ): Promise<ManagerActivity> {
    const ids = resolveScope(this.access, user, estateId);
    const scope: Prisma.ActivityLogEntryWhereInput[] = [
      { estateId: { in: ids } },
    ];
    if (!estateId) scope.push({ subjectType: 'message', estateId: null });
    const rows = await this.prisma.activityLogEntry.findMany({
      where: { actorUserId: user.id, OR: scope },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        subjectType: true,
        verb: true,
        summary: true,
        occurredAt: true,
        estate: { select: { id: true, name: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        subjectType: r.subjectType,
        verb: r.verb,
        summary: r.summary,
        occurredAt: r.occurredAt.toISOString(),
        estateId: r.estate?.id ?? null,
        estateName: r.estate?.name ?? null,
      })),
    };
  }
}
