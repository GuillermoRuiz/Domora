import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { WaitParty } from '../prisma/client';
import { WAIT_KIND_FOR_PARTY } from './issue-wait-kinds';
import { IssuesService } from '../issues/issues.service';
import type { ResolutionRoute } from './resolution-routes';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaTaskKindRegistry } from '../agenda-tasks/agenda-task-kind-registry.service';
import { IssueEventsService } from './issue-events.service';
import {
  IssueWorkflowService,
  type OpenedTask,
  type RequesterInformResult,
} from './issue-workflow.service';
import {
  approveQuote,
  chaseProvider,
  confirmVisitOutcome,
  informRequester,
  reviewIssue,
} from './task-kinds/issue-task-definitions';

/**
 * Registra los tipos de tarea humana de incidencias y cómo se ejecuta su decisión.
 *
 * `approve_quote` se registra solo con su esquema: se puede abrir y validar,
 * pero su resolución llega con la fase de presupuestos (la API responde 501
 * hasta entonces).
 */
@Injectable()
export class IssueWorkflowTaskKinds implements OnModuleInit {
  constructor(
    private readonly registry: AgendaTaskKindRegistry,
    private readonly prisma: PrismaService,
    private readonly workflow: IssueWorkflowService,
    private readonly events: IssueEventsService,
    // IssuesService depende del workflow: se resuelve al usarlo, no al construir (evita el ciclo de módulos).
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  private issues(): IssuesService {
    if (!this.moduleRef) throw new Error('ISSUES_SERVICE_UNAVAILABLE');
    return this.moduleRef.get(IssuesService, { strict: false });
  }

  onModuleInit(): void {
    this.registry.register({
      ...chaseProvider,
      resolve: async ({ task, payload, resolution, user }) => {
        const { decision } = resolution;
        let nextDueAt: Date | undefined;
        await this.prisma.$transaction(async (tx) => {
          const actor = { kind: 'person' as const, userId: user.id };
          if (decision === 'dismiss') {
            await this.workflow.endWaits(
              tx,
              { issueId: task.issueId, waitId: payload.waitId },
              'cancelled',
              actor,
            );
          } else {
            const wait = await tx.issueWait.findUnique({
              where: { id: payload.waitId },
            });
            // Si la respuesta llegó mientras tanto, no hay nada que re-armar: solo se cierra la tarea.
            if (wait && !wait.endedAt) {
              // Sin plazo indicado por la persona, el intervalo de seguimiento lo da la política.
              nextDueAt = resolution.extendHours
                ? new Date(Date.now() + resolution.extendHours * 3_600_000)
                : await this.workflow.followUpDueAt(tx, {
                    issueId: task.issueId,
                    party: wait.party,
                    phase: 'interval',
                  });
              await this.workflow.rearmWait(tx, wait.id, nextDueAt);
            }
            if (decision === 'contacted') {
              await this.events.record(tx, {
                issueId: task.issueId,
                kind: 'provider_contacted',
                actorKind: 'person',
                authorUserId: user.id,
                text: resolution.note
                  ? `Se reclamó al proveedor por otra vía: ${resolution.note}`
                  : 'Se reclamó al proveedor por otra vía.',
                refType: 'issue_wait',
                refId: payload.waitId,
              });
            }
          }
          await this.workflow.recordTaskResolved(tx, {
            issueId: task.issueId,
            taskId: task.id,
            title: 'Reclamar respuesta al proveedor',
            outcome: decision,
            userId: user.id,
          });
        });
        return {
          outcome: decision === 'dismiss' ? 'dismissed' : 'done',
          resultRef: {
            decision,
            waitId: payload.waitId,
            nextDueAt: nextDueAt?.toISOString(),
          },
        };
      },
    });

    this.registry.register({
      ...confirmVisitOutcome,
      resolve: async ({ task, payload, resolution, user }) => {
        const followUp = await this.prisma.$transaction(async (tx) => {
          await this.workflow.lockIssue(tx, task.issueId);
          const visit = await tx.supplierVisit.findFirst({
            where: { id: payload.visitId, issueId: task.issueId },
            select: { status: true },
          });
          // Si otro camino (la pantalla de la incidencia, el panel del proveedor) ya dejó constancia, solo se cierra la tarea.
          if (!visit || visit.status !== 'planificada') return null;
          const outcome = await this.workflow.recordVisitOutcome(tx, {
            issueId: task.issueId,
            visitId: payload.visitId,
            outcome: resolution.decision,
            notes: resolution.notes,
            actor: { kind: 'person', userId: user.id },
            skipTaskSync: true,
          });
          return outcome.followUp;
        });
        if (followUp) await this.workflow.notifyTaskOpened(followUp);
        await this.workflow.recordTaskResolved(this.prisma, {
          issueId: task.issueId,
          taskId: task.id,
          title: 'Confirmar el resultado de la visita',
          outcome: 'done',
          userId: user.id,
        });
        return {
          outcome: 'done',
          resultRef: {
            decision: resolution.decision,
            visitId: payload.visitId,
          },
        };
      },
    });

    this.registry.register({
      ...reviewIssue,
      resolve: async ({ task, resolution, user }) => {
        const actor = { kind: 'person' as const, userId: user.id };
        const opened: OpenedTask[] = [];
        const informs: RequesterInformResult[] = [];
        let followUpTaskId: string | undefined;
        // Todo en UNA transacción, con la incidencia bloqueada: o la incidencia queda con un siguiente paso, o no se resuelve nada.
        await this.prisma.$transaction(async (tx) => {
          await this.workflow.lockIssue(tx, task.issueId);
          switch (resolution.decision) {
            case 'choose_route': {
              const decided = await this.workflow.decideRoute(tx, {
                issueId: task.issueId,
                route: resolution.route as ResolutionRoute,
                actor,
              });
              opened.push(...decided.tasks);
              break;
            }
            case 'schedule_follow_up': {
              const dueAt = new Date(resolution.dueAt as string);
              if (dueAt.getTime() <= Date.now())
                throw new BadRequestException(
                  'La próxima actuación tiene que ser en el futuro.',
                );
              const followUp = await this.workflow.openTask(tx, {
                issueId: task.issueId,
                kind: 'review_issue',
                payload: { reason: 'follow_up', note: resolution.note },
                discriminator: `follow_up:${task.id}`,
                createdBy: 'system',
                dueAt,
                priority: resolution.priority,
                assigneeUserId: resolution.assigneeUserId,
              });
              // Sin tarea (taskId vacío): la incidencia ya no admite trabajo. Si ya existía es la de un intento anterior de ESTA
              // misma decisión (su discriminador lleva la tarea): se reutiliza, no se abre otra.
              if (!followUp.taskId)
                throw new ConflictException(
                  'La incidencia ya no admite una próxima actuación.',
                );
              followUpTaskId = followUp.taskId;
              if (followUp.created) opened.push(followUp);
              break;
            }
            case 'start_wait': {
              const party = resolution.party as WaitParty;
              const issue = await this.workflow.scope(tx, task.issueId);
              // Una entidad real del directorio cuando se elige; el nombre suelto es el fallback.
              const supplier = resolution.supplierId
                ? await this.workflow.waitSupplier(
                    tx,
                    issue.estateId,
                    party,
                    resolution.supplierId,
                  )
                : null;
              const started = await this.workflow.startWait(tx, {
                issueId: task.issueId,
                party,
                supplierId: supplier?.id ?? null,
                partyLabel: resolution.partyLabel?.trim() || supplier?.name,
                kind: WAIT_KIND_FOR_PARTY[party],
                dueAt: resolution.dueInHours
                  ? new Date(Date.now() + resolution.dueInHours * 3_600_000)
                  : await this.workflow.followUpDueAt(tx, {
                      issueId: task.issueId,
                      party,
                    }),
                actor,
              });
              if (!started.created)
                throw new ConflictException(
                  'Ya hay una espera abierta de ese tipo.',
                );
              break;
            }
            case 'schedule_visit': {
              const scheduledAt = new Date(resolution.scheduledAt as string);
              if (scheduledAt.getTime() <= Date.now())
                throw new BadRequestException(
                  'La visita tiene que ser en el futuro.',
                );
              if (resolution.supplierId && resolution.useAssignedProfessional)
                throw new BadRequestException(
                  'Indica el proveedor o el profesional asignado, no los dos.',
                );
              const issue = await this.workflow.scope(tx, task.issueId);
              const target = await this.workflow.visitTarget(tx, {
                issueId: task.issueId,
                estateId: issue.estateId,
                supplierId: resolution.supplierId,
                useAssigned: resolution.useAssignedProfessional,
                visitorLabel: resolution.visitorLabel,
              });
              const visit = await this.workflow.registerVisit(tx, {
                issueId: task.issueId,
                ...target,
                scheduledAt,
                purpose: resolution.purpose ?? 'Visita por la incidencia',
                actor,
                informRequester: true,
              });
              if (visit.requester) informs.push(visit.requester);
              break;
            }
            case 'mark_resolved': {
              const issue = await this.workflow.scope(tx, task.issueId);
              await this.issues().applyStatusInTx(
                tx,
                issue,
                'Resuelta',
                user,
                informs,
                true,
              );
              break;
            }
            case 'next_step_exists':
            case 'done':
            case 'completed':
              break;
          }
          // Una revisión nunca se cierra a «hecho» sin siguiente paso: toda decisión lo crea o comprueba que ya existe.
          await this.workflow.assertNextStep(tx, task.issueId, task.id);
          await this.workflow.recordTaskResolved(tx, {
            issueId: task.issueId,
            taskId: task.id,
            title: 'Revisar incidencia',
            outcome: 'done',
            userId: user.id,
          });
        });
        for (const inform of informs) await this.workflow.afterCommit(inform);
        for (const t of opened)
          await this.workflow.notifyTaskOpened(t).catch(() => undefined);
        return {
          outcome: 'done',
          resultRef: {
            decision: resolution.decision,
            ...(resolution.route ? { route: resolution.route } : {}),
            ...(followUpTaskId ? { followUpTaskId } : {}),
          },
        };
      },
    });

    this.registry.register({
      ...informRequester,
      resolve: async ({ task, payload, resolution, user }) => {
        const send = resolution.decision === 'send';
        if (send) {
          try {
            const notice = await this.prisma.$transaction((tx) =>
              this.workflow.sendRequesterUpdate(tx, {
                issueId: task.issueId,
                template: payload.template,
                params: { when: payload.when, label: payload.label },
                actor: { kind: 'person', userId: user.id },
                // La misma decisión no registra ni envía dos veces el aviso aunque se reintente tras una caída.
                idempotencyKey: `task:${task.id}`,
              }),
            );
            await this.workflow.deliverRequesterNotice(notice);
          } catch (error) {
            if (
              error instanceof Error &&
              error.message === 'REQUESTER_NOT_REACHABLE'
            )
              throw new BadRequestException(
                'El solicitante no tiene una cuenta para recibir avisos.',
              );
            throw error;
          }
        }
        await this.workflow.recordTaskResolved(this.prisma, {
          issueId: task.issueId,
          taskId: task.id,
          title: 'Informar al solicitante',
          outcome: send ? 'approved' : 'dismissed',
          userId: user.id,
        });
        return {
          outcome: send ? 'approved' : 'dismissed',
          resultRef: { decision: resolution.decision, sent: send },
        };
      },
    });
    this.registry.register(approveQuote);
  }
}
