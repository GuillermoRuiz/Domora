import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { isUUID } from 'class-validator';

import { validateDto } from '../agenda-tasks/agenda-task-kind-registry.service';
import { ACTIVE_ISSUE_STATUSES } from './issue-status.constants';
import { OPEN_STATUSES } from '../agenda-tasks/agenda-task.constants';
import { IssuesService } from './issues.service';
import {
  IssueWorkflowService,
  type OpenedTask,
  type RequesterInformResult,
  type RequesterNotice,
} from '../issue-workflow/issue-workflow.service';
import { IssueEventsService } from '../issue-workflow/issue-events.service';
import { WAIT_KIND_PARTY } from '../issue-workflow/issue-wait-kinds';
import { CLAIM_WAIT_REF_TYPE } from '../issue-workflow/insurance-claims';
import { InsuranceClaimsService } from '../issue-workflow/insurance-claims.service';
import { isResolutionRoute } from '../issue-workflow/resolution-routes';
import {
  EFFECT_SCHEMAS,
  MAX_INTERACTION_EFFECTS,
  SetResolutionRouteDto,
  type RecordVisitOutcomeDto,
  type RescheduleVisitDto,
  type UpdateInsuranceClaimDto,
  type PreviewRequesterNoticeDto,
  type InteractionEffect,
  type InteractionEffectType,
  type InteractionNextStep,
  type RegisterInteractionDto,
} from './dto/register-interaction.dto';

/** Identificador admitido de una integración anterior (cabecera `X-Domora-Legacy-Client`). */
const LEGACY_CLIENT_PATTERN = /^[A-Za-z0-9._/-]{1,60}$/;

export interface InteractionEffectResult {
  type: InteractionEffectType;
  /** Qué quedó creado o cerrado (espera, visita, tarea…). */
  ref?: string;
}

export interface RegisterInteractionResult {
  eventId: string;
  effects: InteractionEffectResult[];
}

/**
 * «Registrar interacción»: la ÚNICA operación de dominio para dejar constancia de una comunicación externa o
 * manual y de sus consecuencias. Hoy la dispara una persona; mañana puede dispararla un job de Domora (voz,
 * API, WhatsApp) con `actor = ai/external` sin cambiar el dominio de la incidencia.
 *
 * Las consecuencias no son una lista libre: cada efecto tiene su esquema estricto, el servidor comprueba que
 * encaje con el estado actual (la espera existe y está abierta, el proveedor es de esta comunidad, la
 * incidencia sigue abierta…) y todo ocurre en una sola transacción: o se aplica todo o no se aplica nada.
 */
/** Nombres de los hitos del sistema para el historial (los propios se leen de la base de datos). */
const SYSTEM_MILESTONE_LABELS: Record<string, string> = {
  created: 'Incidencia creada',
  'community_insurance:contact': 'Contactar con el seguro de la comunidad',
  resolved: 'Incidencia cerrada',
};

@Injectable()
export class IssueInteractionsService {
  private readonly logger = new Logger(IssueInteractionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
    private readonly workflow: IssueWorkflowService,
    private readonly events: IssueEventsService,
    private readonly claims: InsuranceClaimsService,
  ) {}

  /** Lista cerrada de efectos válidos, ya limpios y comprobados contra su esquema. */
  parseEffects(raw: unknown[] | undefined): InteractionEffect[] {
    const list = raw ?? [];
    if (list.length > MAX_INTERACTION_EFFECTS)
      throw new BadRequestException(
        `Como máximo ${MAX_INTERACTION_EFFECTS} efectos por interacción.`,
      );
    const effects = list.map((item, index) => {
      const type = (item as { type?: unknown } | null)?.type;
      if (
        typeof type !== 'string' ||
        !Object.prototype.hasOwnProperty.call(EFFECT_SCHEMAS, type)
      )
        throw new BadRequestException(
          `Efecto ${index + 1}: tipo no permitido.`,
        );
      return validateDto(
        EFFECT_SCHEMAS[type as InteractionEffectType] as new () => object,
        item,
        `Efecto ${index + 1} (${type})`,
      ) as InteractionEffect;
    });
    const resolveAt = effects.findIndex((e) => e.type === 'resolve_issue');
    if (resolveAt !== -1 && resolveAt !== effects.length - 1)
      throw new BadRequestException(
        'Resolver la incidencia tiene que ser el último efecto.',
      );
    for (const type of [
      'schedule_visit',
      'set_resolution_route',
      'inform_requester',
      'resolve_issue',
      'open_follow_up',
      'open_claim',
      'update_claim',
      'assign_provider',
    ] as const)
      if (effects.filter((e) => e.type === type).length > 1)
        throw new BadRequestException(
          `Solo un efecto «${type}» por interacción.`,
        );
    return effects;
  }

  /** Nombre del hito del recorrido al que se asocia una tarea. Un hito propio tiene que existir en ESTA incidencia. */
  private async milestoneLabel(
    db: Pick<Prisma.TransactionClient, 'issueJourneyMilestone'>,
    issueId: string,
    ref: string,
  ): Promise<string> {
    if (isUUID(ref)) {
      const found = await db.issueJourneyMilestone.findFirst({
        where: { id: ref, issueId, templateKey: null },
        select: { label: true },
      });
      if (!found)
        throw new BadRequestException(
          'El hito indicado no existe en esta incidencia.',
        );
      return found.label ?? 'Hito';
    }
    return SYSTEM_MILESTONE_LABELS[ref] ?? ref;
  }

  /** Cada siguiente paso declarado exige el efecto que lo crea; `none` no exige ninguno (se comprueba contra lo que ya hay). */
  private assertNextStepBacked(
    nextStep: InteractionNextStep | undefined,
    effects: InteractionEffect[],
  ): void {
    if (!nextStep || nextStep === 'none') return;
    const needs: Record<
      Exclude<InteractionNextStep, 'none'>,
      InteractionEffectType
    > = {
      task: 'open_follow_up',
      wait: 'start_wait',
      visit: 'schedule_visit',
      route: 'set_resolution_route',
      resolved: 'resolve_issue',
    };
    if (!effects.some((e) => e.type === needs[nextStep]))
      throw new BadRequestException(
        'El siguiente paso indicado no tiene su acción: añade la tarea, la espera, la visita, la vía o la resolución que corresponda.',
      );
  }

  /**
   * Una incidencia activa necesita alguien con la pelota, con la MISMA regla que el cierre de una revisión
   * (`IssueWorkflowService.hasNextStep`): una tarea concreta de la vía vigente (también aparcada), una espera abierta, una visita
   * planificada o trabajo de Domora en curso; no cuentan lo terminal, lo sustituido ni lo de una vía anterior. Si no, la
   * interacción se rechaza entera y se pide definir el siguiente paso.
   */
  private async assertHasNextStep(
    tx: Prisma.TransactionClient,
    issueId: string,
  ): Promise<void> {
    const issue = await tx.issue.findUnique({
      where: { id: issueId },
      select: { status: true },
    });
    if (!issue || !ACTIVE_ISSUE_STATUSES.includes(issue.status)) return;
    if (issue.status === 'PendienteInformacion') return;
    const tasks = await tx.agendaTask.findMany({
      where: { issueId, archivedAt: null, status: { in: OPEN_STATUSES } },
      select: { kind: true, payload: true },
    });
    if (await this.workflow.hasNextStep(tx, issueId, tasks)) return;
    throw new ConflictException({
      code: 'ISSUE_WITHOUT_NEXT_STEP',
      message:
        'La incidencia se quedaría sin siguiente paso: indica qué hay que hacer, a quién se espera, la visita prevista, la nueva vía o que está solucionada.',
    });
  }

  async register(
    issueId: string,
    dto: RegisterInteractionDto,
    user: AuthenticatedUser,
    options: {
      /**
       * Contrato de la gestión (HTTP): `nextStep` obligatorio, salvo un aviso al solicitante o `legacyNoNextStep` (DEPRECADO) de
       * una integración identificada (`legacyClient`). Las llamadas internas (automatizaciones, voz…) no lo piden: son ellas
       * quienes dejan su propio siguiente paso.
       */
      requireNextStep?: boolean;
      /** Identificador de la integración anterior (cabecera `X-Domora-Legacy-Client`): sin él, `legacyNoNextStep` se rechaza. */
      legacyClient?: string;
    } = {},
  ): Promise<RegisterInteractionResult> {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException(
        'Solo la gestión registra interacciones con terceros.',
      );
    const issue = await this.issues.assertIssueAccess(issueId, user);
    let legacyClient: string | undefined;
    if (
      options.requireNextStep &&
      dto.nextStep === undefined &&
      dto.party !== 'requester'
    ) {
      if (!dto.legacyNoNextStep)
        throw new BadRequestException({
          code: 'NEXT_STEP_REQUIRED',
          message:
            'Indica qué pasa ahora (nextStep): tarea, espera, visita, vía, resuelta o sin acción inmediata.',
        });
      // DEPRECADO. No es un atajo general: solo vale para una integración anterior que se identifica, y queda registrado.
      legacyClient = options.legacyClient?.trim();
      if (!legacyClient || !LEGACY_CLIENT_PATTERN.test(legacyClient))
        throw new BadRequestException({
          code: 'LEGACY_CLIENT_REQUIRED',
          message:
            'legacyNoNextStep está deprecado y solo lo admite una integración anterior identificada (cabecera X-Domora-Legacy-Client). Usa nextStep.',
        });
      this.logger.warn(
        `DEPRECATED legacyNoNextStep: client=${legacyClient} user=${user.id} issue=${issue.id}`,
      );
    }
    const estateId = issue.estateId;
    if (!estateId)
      throw new BadRequestException('La incidencia no pertenece a una finca.');
    const effects = this.parseEffects(dto.effects);
    this.assertNextStepBacked(dto.nextStep, effects);

    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException(
        'La interacción no puede haber ocurrido en el futuro.',
      );
    if (dto.supplierId && !['provider', 'insurer'].includes(dto.party))
      throw new BadRequestException(
        'Solo un proveedor o una aseguradora se vinculan al directorio de proveedores.',
      );

    const actor = { kind: 'person' as const, userId: user.id };
    // La referencia que dio la aseguradora queda también en la comunicación, venga en el campo suelto o en el siniestro.
    const claimRef =
      dto.claimRef ??
      effects.find((e) => e.type === 'open_claim' || e.type === 'update_claim')
        ?.reference;
    const notices: RequesterNotice[] = [];
    const informs: RequesterInformResult[] = [];
    const tasks: OpenedTask[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      // Se serializa por incidencia y se vuelve a leer su estado: no se aplica nada sobre un estado viejo.
      await tx.$queryRaw`SELECT 1 FROM "issues" WHERE "id" = ${issue.id}::uuid FOR UPDATE`;
      const current = await tx.issue.findFirst({
        where: { id: issue.id, deletedAt: null },
        select: { status: true, ref: true },
      });
      if (!current) throw new BadRequestException('Incidencia no encontrada.');
      if (!ACTIVE_ISSUE_STATUSES.includes(current.status))
        throw new ConflictException(
          'La incidencia ya está resuelta o cerrada: no admite nuevas interacciones.',
        );

      const supplier = dto.supplierId
        ? await this.supplierOf(tx, estateId, dto.supplierId)
        : null;
      const event = await this.events.record(tx, {
        issueId: issue.id,
        kind: 'communication',
        actorKind: actor.kind,
        authorUserId: actor.userId,
        date: occurredAt,
        text: dto.summary,
        meta: {
          channel: dto.channel,
          direction: dto.direction,
          party: dto.party,
          partyLabel: dto.partyLabel ?? supplier?.name ?? null,
          supplierId: supplier?.id ?? null,
          ...(claimRef ? { claimRef } : {}),
          effects: effects.map((e) => e.type),
          ...(legacyClient ? { legacyNoNextStep: true, legacyClient } : {}),
        },
      });

      const results: InteractionEffectResult[] = [];
      for (const effect of effects) {
        switch (effect.type) {
          case 'end_wait': {
            const wait = await tx.issueWait.findFirst({
              where: { id: effect.waitId, issueId: issue.id },
            });
            if (!wait)
              throw new BadRequestException(
                'Esa espera no pertenece a esta incidencia.',
              );
            if (wait.endedAt)
              throw new ConflictException('Esa espera ya estaba cerrada.');
            await this.workflow.endWaits(
              tx,
              { issueId: issue.id, waitId: wait.id },
              effect.reason,
              actor,
            );
            // Su seguimiento (tarea de reclamar, recordatorios sin enviar) ya no tiene objeto.
            await this.workflow.retireWaitFollowUp(tx, issue.id, wait.id);
            results.push({ type: effect.type, ref: wait.id });
            break;
          }
          case 'start_wait': {
            const party = WAIT_KIND_PARTY[effect.kind];
            if (effect.claimId && effect.kind !== 'insurer_reply')
              throw new BadRequestException(
                'El siniestro solo se indica al esperar a la aseguradora.',
              );
            // La espera a la aseguradora pertenece a su siniestro (el único vivo; con varios hay que indicarlo).
            const claim =
              effect.kind === 'insurer_reply'
                ? await this.claims.claimForInsurerWait(
                    tx,
                    issue.id,
                    effect.claimId,
                  )
                : null;
            const target = effect.supplierId
              ? await this.workflow.waitSupplier(
                  tx,
                  estateId,
                  party,
                  effect.supplierId,
                )
              : claim?.insurerSupplierId
                ? await tx.supplier.findFirst({
                    where: {
                      id: claim.insurerSupplierId,
                      estateId,
                      status: 'Activo',
                    },
                    select: { id: true, name: true },
                  })
                : null;
            const label =
              effect.partyLabel ??
              target?.name ??
              claim?.insurerName ??
              dto.partyLabel;
            if (!label)
              throw new BadRequestException(
                'Indica a quién se espera (proveedor del directorio o nombre).',
              );
            const dueAt = effect.dueInHours
              ? new Date(Date.now() + effect.dueInHours * 3_600_000)
              : await this.workflow.followUpDueAt(tx, {
                  issueId: issue.id,
                  party,
                });
            const started = await this.workflow.startWait(tx, {
              issueId: issue.id,
              party,
              supplierId: target?.id ?? null,
              partyLabel: label,
              kind: effect.kind,
              dueAt,
              actor,
              ...(claim
                ? { refType: CLAIM_WAIT_REF_TYPE, refId: claim.id }
                : {}),
            });
            if (!started.created)
              throw new ConflictException(
                'Ya hay una espera abierta de ese tipo.',
              );
            // Pedir al propietario que tramite el siniestro ya está hecho: ahora se le espera a él.
            if (party === 'owner')
              await this.workflow.resolveTasks(tx, issue.id, 'review_issue', {
                outcome: 'done',
                resultRef: { decision: 'done' },
                userId: user.id,
                discriminator: 'ask_owner_file_claim',
              });
            results.push({ type: effect.type, ref: started.waitId });
            break;
          }
          case 'schedule_visit': {
            // Sin proveedor del directorio, la visita es de quien se nombra (el propietario, un tercero…) o, si no se nombra a
            // nadie, del profesional asignado (puede no ser proveedor de la comunidad).
            const visitorLabel = effect.visitorLabel?.trim() || undefined;
            const target = await this.workflow.visitTarget(tx, {
              issueId: issue.id,
              estateId,
              supplierId: effect.supplierId,
              useAssigned: !visitorLabel,
              visitorLabel,
            });
            const scheduledAt = new Date(effect.scheduledAt);
            if (scheduledAt.getTime() <= Date.now())
              throw new BadRequestException(
                'La visita programada tiene que ser futura.',
              );
            const visit = await this.workflow.registerVisit(tx, {
              issueId: issue.id,
              ...target,
              scheduledAt,
              purpose:
                effect.purpose ?? `Visita por la incidencia ${current.ref}`,
              actor,
              // Si la propia interacción ya avisa a la solicitante, la política no vuelve a proponerlo.
              informRequester: !effects.some(
                (e) => e.type === 'inform_requester',
              ),
            });
            if (visit.requester) informs.push(visit.requester);
            results.push({ type: effect.type, ref: visit.visitId });
            break;
          }
          case 'open_follow_up': {
            const dueAt = effect.dueAt ? new Date(effect.dueAt) : undefined;
            if (dueAt && dueAt.getTime() <= Date.now())
              throw new BadRequestException(
                'El recordatorio del seguimiento tiene que ser futuro.',
              );
            const task = await this.workflow.openTask(tx, {
              issueId: issue.id,
              kind: 'review_issue',
              payload: {
                reason: 'follow_up',
                note: effect.note,
                milestone: effect.milestone,
              },
              milestoneLabel: await this.milestoneLabel(
                tx,
                issue.id,
                effect.milestone,
              ),
              // Misma nota a otra hora es otro recordatorio; la misma nota a la misma hora es la misma tarea.
              discriminator: `follow_up:${createHash('sha1')
                .update(
                  `${effect.note}|${effect.dueAt ?? ''}|${effect.milestone}`,
                )
                .digest('hex')
                .slice(0, 10)}`,
              createdBy: 'system',
              dueAt,
              priority: effect.priority,
              assigneeUserId: effect.assigneeUserId,
            });
            if (task.created) tasks.push(task);
            results.push({ type: effect.type, ref: task.taskId });
            break;
          }
          case 'set_resolution_route': {
            const routed = await this.workflow.decideRoute(tx, {
              issueId: issue.id,
              route: effect.route,
              reason: effect.reason,
              actor,
            });
            tasks.push(...routed.tasks);
            results.push({ type: effect.type });
            break;
          }
          case 'open_claim': {
            const opened = await this.claims.open(tx, {
              issueId: issue.id,
              actor,
              insurerSupplierId:
                effect.insurerSupplierId ??
                (dto.party === 'insurer' ? dto.supplierId : undefined),
              insurerName:
                effect.insurerName ??
                (dto.party === 'insurer' ? dto.partyLabel : undefined),
              contractId: effect.contractId,
              policyNumber: effect.policyNumber,
              reference: effect.reference ?? dto.claimRef,
              contactName: effect.contactName,
              contactPhone: effect.contactPhone,
            });
            results.push({ type: effect.type, ref: opened.claim.id });
            break;
          }
          case 'update_claim': {
            const updated = await this.claims.update(tx, {
              issueId: issue.id,
              claimId: effect.claimId,
              actor,
              reference: effect.reference,
              status: effect.status,
              contactName: effect.contactName,
              contactPhone: effect.contactPhone,
              policyNumber: effect.policyNumber,
            });
            tasks.push(...updated.tasks);
            results.push({ type: effect.type, ref: updated.claim.id });
            break;
          }
          case 'assign_provider': {
            const name = effect.name?.trim();
            if (!!effect.supplierId === !!name)
              throw new BadRequestException(
                'Indica el profesional: del directorio o por su nombre (no las dos cosas).',
              );
            // Lo envía una aseguradora: queda atado al siniestro (el único vivo; con varios hay que indicarlo).
            const claim =
              effect.byInsurer || effect.claimId
                ? await this.claims.resolveClaim(tx, issue.id, effect.claimId)
                : null;
            const pro = effect.supplierId
              ? await this.supplierOf(tx, estateId, effect.supplierId)
              : null;
            const assigned = await this.workflow.assignProvider(tx, {
              issueId: issue.id,
              supplierId: pro?.id,
              name: pro?.name ?? (name as string),
              category: pro?.category,
              phone: effect.phone?.trim() || pro?.phone || null,
              claimId: claim?.id,
              insurerName: claim?.insurerName,
              actor,
            });
            results.push({ type: effect.type, ref: assigned.assignmentId });
            break;
          }
          case 'inform_requester': {
            try {
              notices.push(
                await this.workflow.sendRequesterUpdate(tx, {
                  issueId: issue.id,
                  template: effect.template,
                  params: {
                    when: effect.when,
                    label: effect.label,
                    text: effect.text,
                  },
                  actor,
                }),
              );
            } catch (error) {
              if (!(error instanceof Error)) throw error;
              if (error.message === 'REQUESTER_NOT_REACHABLE')
                throw new ConflictException(
                  'El solicitante no tiene una cuenta para recibir avisos.',
                );
              if (error.message === 'REQUESTER_TEMPLATE_PARAMS_MISSING')
                throw new BadRequestException(
                  'Faltan datos para el mensaje al solicitante (fecha, nombre del tercero o texto).',
                );
              throw error;
            }
            results.push({ type: effect.type });
            break;
          }
          case 'resolve_issue': {
            await this.issues.applyStatusInTx(
              tx,
              issue,
              'Resuelta',
              user,
              informs,
              true,
            );
            results.push({ type: effect.type });
            break;
          }
        }
      }
      // «Revisar incidencia nueva» pedía decidir cómo gestionarla: si con esta gestión el caso ya avanzó y queda un
      // siguiente paso real, esa tarea se sustituye (si no, se mantiene: no se deja la incidencia sin pelota).
      await this.workflow.settleEntryReview(tx, issue.id, actor);
      // «¿Qué pasa ahora?»: declarado un siguiente paso, la incidencia no puede quedar activa sin nadie con la pelota.
      if (dto.nextStep && dto.nextStep !== 'resolved')
        await this.assertHasNextStep(tx, issue.id);
      return { eventId: event.id, effects: results };
    });

    // Ya confirmada la transacción: avisos al solicitante y tareas nuevas.
    for (const notice of notices)
      await this.workflow.deliverRequesterNotice(notice);
    for (const inform of informs) await this.workflow.afterCommit(inform);
    for (const task of tasks) await this.workflow.notifyTaskOpened(task);
    return result;
  }

  /**
   * Vista previa del aviso al solicitante: el texto exacto que se enviaría con `inform_requester` (mismo renderizado,
   * mismas comprobaciones). No envía nada ni crea eventos.
   */
  async previewRequesterNotice(
    issueId: string,
    dto: PreviewRequesterNoticeDto,
    user: AuthenticatedUser,
  ): Promise<{ title: string; body: string }> {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión informa al solicitante.');
    const issue = await this.issues.assertIssueAccess(issueId, user);
    try {
      return await this.workflow.previewRequesterUpdate(this.prisma, {
        issueId: issue.id,
        template: dto.template,
        params: { when: dto.when, label: dto.label, text: dto.text },
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (error.message === 'REQUESTER_NOT_REACHABLE')
        throw new ConflictException(
          'El solicitante no tiene una cuenta para recibir avisos.',
        );
      if (error.message === 'REQUESTER_TEMPLATE_PARAMS_MISSING')
        throw new BadRequestException(
          'Faltan datos para el mensaje al solicitante (fecha, nombre del tercero o texto).',
        );
      throw error;
    }
  }

  /** Una PERSONA decide la vía de gestión de la incidencia (`null` = volver a «sin decidir»). */
  async decideRoute(
    issueId: string,
    dto: SetResolutionRouteDto,
    user: AuthenticatedUser,
  ) {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión decide la vía de gestión.');
    const issue = await this.issues.assertIssueAccess(issueId, user);
    if (dto.route === undefined)
      throw new BadRequestException(
        'Indica la vía (o null para dejarla sin decidir).',
      );
    if (dto.route !== null && !isResolutionRoute(dto.route))
      throw new BadRequestException('Vía de gestión no válida.');
    const outcome = await this.prisma.$transaction((tx) =>
      this.workflow.decideRoute(tx, {
        issueId: issue.id,
        route: dto.route,
        reason: dto.reason,
        actor: { kind: 'person', userId: user.id },
      }),
    );
    // La vía decidida puede abrir trabajo humano (abrir el siniestro…): se avisa ya confirmada la transacción.
    for (const task of outcome.tasks)
      await this.workflow.notifyTaskOpened(task);
    return { resolutionRoute: dto.route, changed: outcome.changed };
  }

  /** Siniestros de la incidencia con su etapa derivada, el profesional enviado y lo que se espera de la aseguradora. */
  async listClaims(issueId: string, user: AuthenticatedUser) {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión ve los siniestros.');
    const issue = await this.issues.assertIssueAccess(issueId, user);
    return this.claims.list(issue.id);
  }

  /**
   * Corrige o cambia el estado de un siniestro sin que venga de una comunicación. Es la misma operación que el efecto
   * `update_claim` de «Registrar gestión».
   */
  async updateClaim(
    issueId: string,
    claimId: string,
    dto: UpdateInsuranceClaimDto,
    user: AuthenticatedUser,
  ) {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión cambia un siniestro.');
    const issue = await this.issues.assertIssueAccess(issueId, user);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "issues" WHERE "id" = ${issue.id}::uuid FOR UPDATE`;
      return this.claims.update(tx, {
        issueId: issue.id,
        claimId,
        actor: { kind: 'person', userId: user.id },
        reference: dto.reference,
        status: dto.status,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        policyNumber: dto.policyNumber,
      });
    });
    for (const task of updated.tasks)
      await this.workflow.notifyTaskOpened(task);
    return (await this.claims.list(issue.id)).find((c) => c.id === claimId);
  }

  /** Visitas de la incidencia, con quién las hace (directorio, asignación o nombre) y si ya venció su hora sin resultado. */
  async listVisits(issueId: string, user: AuthenticatedUser) {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión ve las visitas.');
    const issue = await this.issues.assertIssueAccess(issueId, user);
    const visits = await this.prisma.supplierVisit.findMany({
      where: { issueId: issue.id },
      orderBy: { scheduledAt: 'asc' },
      include: {
        supplier: { select: { id: true, name: true } },
        assignment: {
          select: { id: true, providerNameSnapshot: true, claimId: true },
        },
      },
    });
    const now = Date.now();
    return visits.map((v) => ({
      id: v.id,
      status: v.status,
      scheduledAt: v.scheduledAt,
      purpose: v.purpose,
      notes: v.notes,
      completedAt: v.completedAt,
      cancelledAt: v.cancelledAt,
      supplierId: v.supplierId,
      assignmentId: v.assignmentId,
      professionalName:
        v.supplier?.name ??
        v.assignment?.providerNameSnapshot ??
        v.visitorLabel ??
        null,
      sentByInsurer: !!v.assignment?.claimId,
      // Pasó su hora y sigue planificada: falta confirmar qué ocurrió.
      overdue: v.status === 'planificada' && v.scheduledAt.getTime() < now,
    }));
  }

  /**
   * El resultado de una visita planificada (se realizó / no se realizó o se canceló), desde la incidencia: es la misma
   * operación que la de la tarea «confirmar el resultado de la visita». Una visita realizada no resuelve la incidencia.
   */
  async recordVisitOutcome(
    issueId: string,
    visitId: string,
    dto: RecordVisitOutcomeDto,
    user: AuthenticatedUser,
  ) {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException(
        'Solo la gestión registra el resultado de una visita.',
      );
    const issue = await this.issues.assertIssueAccess(issueId, user);
    const outcome = await this.prisma.$transaction((tx) =>
      this.workflow.recordVisitOutcome(tx, {
        issueId: issue.id,
        visitId,
        outcome: dto.outcome,
        notes: dto.notes,
        actor: { kind: 'person', userId: user.id },
      }),
    );
    if (outcome.followUp)
      await this.workflow.notifyTaskOpened(outcome.followUp);
    return {
      visitId: outcome.visitId,
      status: outcome.status,
      followUp: !!outcome.followUp,
    };
  }

  /**
   * Cambia la hora de una visita planificada, desde la incidencia (la misma operación que usa el panel del proveedor para una
   * visita ligada a una incidencia). Deja el evento y reconcilia el aviso al solicitante con las plantillas de siempre.
   */
  async rescheduleVisit(
    issueId: string,
    visitId: string,
    dto: RescheduleVisitDto,
    user: AuthenticatedUser,
  ) {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException('Solo la gestión reprograma una visita.');
    const issue = await this.issues.assertIssueAccess(issueId, user);
    const moved = await this.prisma.$transaction((tx) =>
      this.workflow.rescheduleVisit(tx, {
        issueId: issue.id,
        visitId,
        scheduledAt: new Date(dto.scheduledAt),
        actor: { kind: 'person', userId: user.id },
      }),
    );
    await this.workflow.afterCommit(moved.requester);
    return {
      visitId: moved.visitId,
      scheduledAt: moved.scheduledAt,
      changed: moved.changed,
    };
  }

  private supplierOf(
    tx: Prisma.TransactionClient,
    estateId: string,
    supplierId: string,
  ) {
    return this.workflow.activeSupplier(tx, estateId, supplierId);
  }
}
