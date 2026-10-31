import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { RESOLVED_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { CLAIM_WAIT_REF_TYPE } from './insurance-claims';
import {
  projectJourney,
  type JourneyFacts,
  type JourneyView,
} from './issue-journey';
import { taskActionLabel } from './issue-situation';
import { IssueEventsService } from './issue-events.service';
import type { IssueEventKind } from './issue-event-kinds';
import type { ResolutionRoute } from './resolution-routes';
import type { IssueStatus } from '../prisma/client';

/**
 * Recorrido de la incidencia: una PROYECCIÓN de lo que ha ocurrido, lo que toca ahora y el siguiente paso previsible. Solo lee:
 * lo que ejecuta cada acción (registrar actividad, resolver, cambiar la vía…) vive en sus servicios de siempre. Lo único que
 * escribe son los hitos propios de la gestión y los ajustes de nombre u ocultación de un hito del sistema.
 */
@Injectable()
export class IssueJourneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly events: IssueEventsService,
  ) {}

  /** Cada cambio del recorrido deja su rastro en el historial de la incidencia. */
  private trace(
    issueId: string,
    user: AuthenticatedUser,
    kind: IssueEventKind,
    text: string,
    milestone: string,
  ) {
    return this.events.record(this.prisma, {
      issueId,
      kind,
      actorKind: 'person',
      authorUserId: user.id,
      text,
      refType: 'journey_milestone',
      meta: { milestone },
    });
  }

  private async scoped(issueId: string, user: AuthenticatedUser) {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión ve el recorrido.');
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
      select: {
        id: true,
        estateId: true,
        status: true,
        resolutionRoute: true,
        createdAt: true,
        resolvedAt: true,
        closedAt: true,
      },
    });
    if (!issue)
      throw new NotFoundException(`Incidencia ${issueId} no encontrada.`);
    if (issue.estateId) this.estateAccess.assertAccess(issue.estateId, user);
    return issue;
  }

  private async facts(
    issue: Awaited<ReturnType<IssueJourneyService['scoped']>>,
  ): Promise<JourneyFacts> {
    const now = new Date();
    const [tasks, waits, visits, claims, events] = await Promise.all([
      this.prisma.agendaTask.findMany({
        where: { issueId: issue.id, archivedAt: null },
        select: {
          id: true,
          kind: true,
          payload: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          endAt: true,
          dueAt: true,
          createdAt: true,
          completedAt: true,
          assignedTo: { select: { fullName: true } },
        },
      }),
      this.prisma.issueWait.findMany({ where: { issueId: issue.id } }),
      this.prisma.supplierVisit.findMany({
        where: { issueId: issue.id, status: { not: 'cancelada' } },
        select: {
          id: true,
          scheduledAt: true,
          completedAt: true,
          status: true,
          purpose: true,
          visitorLabel: true,
          supplier: { select: { name: true } },
          assignment: { select: { providerNameSnapshot: true } },
        },
      }),
      this.prisma.insuranceClaim.findMany({
        where: { issueId: issue.id },
        orderBy: { openedAt: 'asc' },
        select: {
          id: true,
          insurerName: true,
          reference: true,
          status: true,
          openedAt: true,
          closedAt: true,
        },
      }),
      this.prisma.issueTimelineEntry.findMany({
        where: {
          issueId: issue.id,
          kind: {
            in: [
              'route_decided',
              'communication',
              'claim_updated',
              'status_changed',
            ],
          },
        },
        orderBy: { date: 'asc' },
        select: {
          id: true,
          kind: true,
          date: true,
          refId: true,
          meta: true,
          fromStatus: true,
          toStatus: true,
        },
      }),
    ]);
    const solved = RESOLVED_ISSUE_STATUSES.includes(issue.status);
    return {
      now,
      route: issue.resolutionRoute as ResolutionRoute | null,
      issueStatus: issue.status,
      createdAt: issue.createdAt,
      resolvedAt: solved ? (issue.resolvedAt ?? issue.closedAt ?? now) : null,
      terminal: solved || issue.status === 'Retirada',
      awaitingRequesterInfo: issue.status === 'PendienteInformacion',
      tasks: tasks.map((t) => ({
        id: t.id,
        kind: t.kind,
        reason: (t.payload as { reason?: string } | null)?.reason ?? null,
        label: taskActionLabel(t),
        status: t.status,
        priority: t.priority,
        assigneeName: t.assignedTo?.fullName ?? null,
        dueAt: t.dueAt ?? t.endAt,
        createdAt: t.createdAt,
        completedAt: t.completedAt,
      })),
      waits: waits.map((w) => ({
        id: w.id,
        kind: w.kind,
        party: w.party,
        partyLabel: w.partyLabel,
        startedAt: w.startedAt,
        dueAt: w.dueAt,
        endedAt: w.endedAt,
        endReason: w.endReason,
        claimId: w.refType === CLAIM_WAIT_REF_TYPE ? w.refId : null,
      })),
      visits: visits.map((v) => ({
        id: v.id,
        scheduledAt: v.scheduledAt,
        completedAt: v.completedAt,
        status: v.status,
        purpose: v.purpose,
        visitor:
          v.supplier?.name ??
          v.assignment?.providerNameSnapshot ??
          v.visitorLabel ??
          'el profesional',
      })),
      claims,
      events: events.map((e) => ({
        ...e,
        meta: (e.meta as Record<string, unknown> | null) ?? null,
      })),
    };
  }

  async forIssue(
    issueId: string,
    user: AuthenticatedUser,
  ): Promise<JourneyView> {
    const issue = await this.scoped(issueId, user);
    const overrides = await this.prisma.issueJourneyMilestone.findMany({
      where: { issueId },
    });
    return projectJourney(await this.facts(issue), overrides);
  }

  /** Un hito propio de la gestión: se muestra como pendiente hasta que ella lo da por hecho. */
  async add(
    issueId: string,
    user: AuthenticatedUser,
    input: { label: string; linkedStatus?: string; afterKey?: string },
  ): Promise<JourneyView> {
    const issue = await this.scoped(issueId, user);
    const label = input.label?.trim();
    if (!label) throw new BadRequestException('El hito necesita un nombre.');
    const last = await this.prisma.issueJourneyMilestone.aggregate({
      where: { issueId, templateKey: null },
      _max: { position: true },
    });
    const nextPosition = (last._max.position ?? 0) + 10;
    // Los hitos propios de la vía de seguro siempre quedan dentro de sus dos anclajes fijos.
    const position =
      issue.resolutionRoute === 'community_insurance'
        ? Math.max(1, Math.min(999_999, nextPosition))
        : nextPosition;
    const created = await this.prisma.issueJourneyMilestone.create({
      data: {
        issueId,
        label: label.slice(0, 120),
        position,
        linkedStatus: input.linkedStatus as IssueStatus | undefined,
        createdByUserId: user.id,
      },
    });
    await this.trace(
      issueId,
      user,
      'milestone_added',
      `Hito añadido: «${created.label}»`,
      created.id,
    );
    return this.forIssue(issueId, user);
  }

  /** Claves de los hitos del sistema que ya ocurrieron: los únicos que admiten cambio de nombre u ocultarse. */
  private async systemKeys(
    issue: Awaited<ReturnType<IssueJourneyService['scoped']>>,
  ): Promise<Set<string>> {
    const view = projectJourney(await this.facts(issue), []);
    return new Set(
      view.steps
        .filter((s) => !s.custom && (s.status === 'completed' || s.milestone))
        .map((s) => s.key),
    );
  }

  /**
   * `ref`: id de un hito propio o clave de uno del sistema. Un hito propio puede renombrarse y darse por hecho; uno del sistema
   * solo cambia de nombre (salvo «contactar con el seguro», que sí se da por hecho a mano): lo que ocurrió lo dicen las tareas, esperas, visitas y siniestros, no se declara a mano.
   */
  async update(
    issueId: string,
    ref: string,
    user: AuthenticatedUser,
    input: {
      label?: string;
      done?: boolean;
      position?: number;
      linkedStatus?: string | null;
    },
  ): Promise<JourneyView> {
    const issue = await this.scoped(issueId, user);
    const data: {
      label?: string | null;
      doneAt?: Date | null;
      position?: number;
      linkedStatus?: IssueStatus | null;
    } = {};
    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) throw new BadRequestException('El hito necesita un nombre.');
      data.label = label.slice(0, 120);
    }
    if (input.position !== undefined) data.position = input.position;
    if (input.linkedStatus !== undefined && ref !== 'resolved')
      data.linkedStatus = input.linkedStatus as IssueStatus | null;
    let name = ref;
    let before: {
      label: string | null;
      doneAt: Date | null;
      linkedStatus: IssueStatus | null;
      position: number | null;
    } = {
      label: null,
      doneAt: null,
      linkedStatus: null,
      position: null,
    };
    if (isUUID(ref)) {
      const found = await this.prisma.issueJourneyMilestone.findFirst({
        where: { id: ref, issueId, templateKey: null },
      });
      if (!found) throw new NotFoundException('Hito no encontrado.');
      name = found.label ?? 'Hito';
      before = found;
      if (
        data.position !== undefined &&
        issue.resolutionRoute === 'community_insurance'
      )
        data.position = Math.max(1, Math.min(999_999, data.position));
      if (input.done !== undefined)
        data.doneAt = input.done ? new Date() : null;
      await this.prisma.issueJourneyMilestone.update({
        where: { id: ref },
        data,
      });
    } else {
      // Solo el hito «contactar con el seguro» (el que la gestión hace fuera de Domora) se da por hecho a mano.
      if (input.done !== undefined && ref !== 'community_insurance:contact')
        throw new BadRequestException(
          'Un hito del sistema no se marca a mano: se cumple cuando ocurre.',
        );
      if (!(await this.systemKeys(issue)).has(ref))
        throw new NotFoundException('Hito no encontrado.');
      if (input.done !== undefined)
        data.doneAt = input.done ? new Date() : null;
      const current = (await this.forIssue(issueId, user)).steps.find(
        (s) => s.key === ref,
      );
      name = current?.label ?? ref;
      const override = await this.prisma.issueJourneyMilestone.findUnique({
        where: { issueId_templateKey: { issueId, templateKey: ref } },
      });
      before = {
        label: override?.label ?? null,
        doneAt: override?.doneAt ?? null,
        linkedStatus: override?.linkedStatus ?? null,
        position: override?.position ?? null,
      };
      await this.prisma.issueJourneyMilestone.upsert({
        where: { issueId_templateKey: { issueId, templateKey: ref } },
        create: {
          issueId,
          templateKey: ref,
          createdByUserId: user.id,
          ...data,
        },
        update: data,
      });
    }
    if (data.label !== undefined && data.label !== (before.label ?? name))
      await this.trace(
        issueId,
        user,
        'milestone_renamed',
        `Hito renombrado: «${name}» → «${data.label}»`,
        ref,
      );
    const shown = data.label ?? name;
    if (
      data.linkedStatus !== undefined &&
      data.linkedStatus !== before.linkedStatus
    )
      await this.trace(
        issueId,
        user,
        'milestone_linked',
        data.linkedStatus
          ? `Hito «${shown}» asociado al estado «${data.linkedStatus}»`
          : `Hito «${shown}» sin estado asociado`,
        ref,
      );
    if (data.doneAt !== undefined && !!data.doneAt !== !!before.doneAt)
      await this.trace(
        issueId,
        user,
        data.doneAt ? 'milestone_done' : 'milestone_reopened',
        data.doneAt
          ? `Hito completado: «${shown}»`
          : `Hito reabierto: «${shown}»`,
        ref,
      );
    if (data.position !== undefined && data.position !== before.position)
      await this.trace(
        issueId,
        user,
        'milestone_moved',
        `Hito reordenado: «${shown}»`,
        ref,
      );
    return this.forIssue(issueId, user);
  }

  /** Un hito propio se borra; uno del sistema solo se oculta (lo que ocurrió sigue en el historial). */
  async remove(
    issueId: string,
    ref: string,
    user: AuthenticatedUser,
  ): Promise<JourneyView> {
    const issue = await this.scoped(issueId, user);
    if (isUUID(ref)) {
      const found = await this.prisma.issueJourneyMilestone.findFirst({
        where: { id: ref, issueId, templateKey: null },
      });
      if (!found) throw new NotFoundException('Hito no encontrado.');
      await this.prisma.issueJourneyMilestone.delete({ where: { id: ref } });
      await this.trace(
        issueId,
        user,
        'milestone_removed',
        `Hito quitado: «${found.label ?? 'Hito'}»`,
        ref,
      );
    } else {
      if (ref === 'created' || ref === 'resolved')
        throw new BadRequestException('Ese hito no se puede quitar.');
      if (!(await this.systemKeys(issue)).has(ref))
        throw new NotFoundException('Hito no encontrado.');
      const shownLabel =
        (await this.forIssue(issueId, user)).steps.find((s) => s.key === ref)
          ?.label ?? ref;
      await this.prisma.issueJourneyMilestone.upsert({
        where: { issueId_templateKey: { issueId, templateKey: ref } },
        create: {
          issueId,
          templateKey: ref,
          hidden: true,
          createdByUserId: user.id,
        },
        update: { hidden: true },
      });
      await this.trace(
        issueId,
        user,
        'milestone_removed',
        `Hito quitado: «${shownLabel}»`,
        ref,
      );
    }
    return this.forIssue(issueId, user);
  }
}
