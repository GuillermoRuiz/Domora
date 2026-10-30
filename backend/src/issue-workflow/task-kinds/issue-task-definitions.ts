import { renderRequesterMessage } from '../requester-messages';
import type {
  TaskBuild,
  TaskBuildContext,
  TaskDb,
  TaskKindDefinition,
} from '../../agenda-tasks/agenda-task-kind.types';
import {
  ApproveQuotePayload,
  ApproveQuoteResolution,
  ApproveQuoteResultRef,
  ChaseProviderPayload,
  ChaseProviderResolution,
  ChaseProviderResultRef,
  InformRequesterPayload,
  InformRequesterResolution,
  InformRequesterResultRef,
  ConfirmVisitOutcomePayload,
  ConfirmVisitOutcomeResolution,
  ConfirmVisitOutcomeResultRef,
  ReviewIssuePayload,
  ReviewIssueResolution,
  ReviewIssueResultRef,
} from './task-kind.dtos';

/**
 * Tipos de tarea humana de las incidencias: esquema y texto. Sin `resolve`:
 * quien ejecuta la decisión lo añade al registrarlos (`withResolver`), porque
 * necesita servicios que viven en otros módulos (envío de emails, esperas…).
 */

export const ISSUE_TASK_KINDS = [
  'confirm_visit_outcome',
  'chase_provider',
  'review_issue',
  'approve_quote',
  'inform_requester',
] as const;
export type IssueTaskKind = (typeof ISSUE_TASK_KINDS)[number];

async function supplierName(
  db: TaskDb,
  id: string | undefined,
): Promise<string> {
  if (!id) return 'el proveedor';
  const supplier = await db.supplier.findUnique({
    where: { id },
    select: { name: true },
  });
  return supplier?.name ?? 'el proveedor';
}

/**
 * Título y descripción de toda tarea de una incidencia. El título es siempre la propia incidencia («#INC-2026-001 · Fuga en el
 * garaje»), para que en la bandeja de Tareas se vea de cuál se trata; qué hay que hacer va en la primera línea de la
 * descripción, y el resto del texto detrás.
 */
const taskText = (
  ctx: TaskBuildContext<object>,
  action: string,
  detail?: string,
): Pick<TaskBuild, 'title' | 'description'> => ({
  title: `${ctx.issue.ref} · ${ctx.issue.title}`,
  description: detail ? `${action}\n${detail}` : action,
});

const euros = (cents: number): string =>
  (cents / 100).toLocaleString('es-ES', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export const confirmVisitOutcome: TaskKindDefinition<
  ConfirmVisitOutcomePayload,
  ConfirmVisitOutcomeResolution,
  ConfirmVisitOutcomeResultRef
> = {
  kind: 'confirm_visit_outcome',
  payload: ConfirmVisitOutcomePayload,
  resolution: ConfirmVisitOutcomeResolution,
  resultRef: ConfirmVisitOutcomeResultRef,
  async build(ctx): Promise<TaskBuild> {
    const visit = await ctx.db.supplierVisit.findUnique({
      where: { id: ctx.payload.visitId },
      select: {
        scheduledAt: true,
        visitorLabel: true,
        supplier: { select: { name: true } },
        assignment: { select: { providerNameSnapshot: true } },
      },
    });
    const name =
      visit?.supplier?.name ??
      visit?.assignment?.providerNameSnapshot ??
      visit?.visitorLabel ??
      'el profesional';
    const when = visit
      ? new Intl.DateTimeFormat('es-ES', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone: 'Europe/Madrid',
        }).format(visit.scheduledAt)
      : null;
    return {
      ...taskText(
        ctx,
        `Confirmar el resultado de la visita de ${name}`,
        `La visita estaba prevista${when ? ` el ${when}` : ''} y no consta qué ocurrió: indica si se realizó o si no llegó a hacerse.`,
      ),
    };
  },
};

export const chaseProvider: TaskKindDefinition<
  ChaseProviderPayload,
  ChaseProviderResolution,
  ChaseProviderResultRef
> = {
  kind: 'chase_provider',
  payload: ChaseProviderPayload,
  resolution: ChaseProviderResolution,
  resultRef: ChaseProviderResultRef,
  async build(ctx): Promise<TaskBuild> {
    const wait = await ctx.db.issueWait.findUnique({
      where: { id: ctx.payload.waitId },
      select: { partyLabel: true, startedAt: true },
    });
    const name =
      wait?.partyLabel ?? (await supplierName(ctx.db, ctx.payload.supplierId));
    const days = wait
      ? Math.max(
          1,
          Math.floor((Date.now() - wait.startedAt.getTime()) / 86_400_000),
        )
      : null;
    return {
      ...taskText(
        ctx,
        days === null
          ? `${name} no ha respondido`
          : `${name} lleva ${days} ${days === 1 ? 'día' : 'días'} sin responder`,
        'Decide si seguir esperando, si ya le has reclamado tú o si ya no hace falta su respuesta.',
      ),
    };
  },
};

export const reviewIssue: TaskKindDefinition<
  ReviewIssuePayload,
  ReviewIssueResolution,
  ReviewIssueResultRef
> = {
  kind: 'review_issue',
  payload: ReviewIssuePayload,
  resolution: ReviewIssueResolution,
  resultRef: ReviewIssueResultRef,
  build(ctx): Promise<TaskBuild> {
    const texts: Record<ReviewIssuePayload['reason'], [string, string]> = {
      new_issue: [
        'Revisar incidencia nueva',
        'Revisa la incidencia y decide cómo gestionarla: proveedor, seguro, propietario o gestión directa.',
      ],
      manual_review: [
        'Revisar incidencia',
        'Hay novedades en la incidencia que necesitan tu revisión.',
      ],
      missing_provider: [
        'Asignar proveedor',
        'Esta incidencia no tiene un proveedor configurado.',
      ],
      notify_only: [
        'Revisar incidencia',
        'La configuración de la comunidad solo permite avisar al administrador.',
      ],
      no_next_step: [
        'Revisar incidencia: sin siguiente paso',
        'La incidencia sigue abierta y nadie tiene prevista ninguna actuación. Decide el siguiente paso, deja constancia de a quién esperas o ciérrala.',
      ],
      follow_up: [
        'Seguimiento de la incidencia',
        'Hay una actuación pendiente que tú indicaste.',
      ],
      after_visit: [
        'Decidir cómo sigue la incidencia tras la visita',
        'Se dejó constancia del resultado de la visita y no hay otro paso previsto: indica si el problema está solucionado (resuélvela), si necesita otra actuación o si hay que esperar a alguien.',
      ],
      requester_update: [
        'Revisar actualización del solicitante',
        'El solicitante ha añadido una novedad en el historial de la incidencia. Léela y decide si hace falta actuar; la gestión que ya estaba en marcha (esperas, visitas) no se ha tocado.',
      ],
      open_insurance_claim: [
        'Llamar al seguro de la comunidad',
        'La vía es el seguro de la comunidad: abre el siniestro con la aseguradora y regístralo en la incidencia.',
      ],
      ask_owner_file_claim: [
        'Solicitar al propietario que tramite el siniestro',
        'La vía es el seguro del propietario: pídele que abra el siniestro con su aseguradora y deja constancia de que esperas su respuesta.',
      ],
      contact_provider: [
        'Contactar con el proveedor',
        'La vía es el proveedor de la comunidad: escríbele o llámale y deja constancia en la incidencia.',
      ],
      direct_management: [
        'Gestionar la incidencia directamente',
        'La vía es «Administrador»: tú llevas el caso. Deja la siguiente actuación con su fecha o, si ya está solucionado, resuélvela.',
      ],
      claim_rejected: [
        'Decidir cómo seguir: el seguro rechazó la cobertura',
        'Puedes reclamar o reconsiderar el siniestro con la aseguradora, o cambiar la vía de gestión.',
      ],
    };
    const [title, detail] = texts[ctx.payload.reason];
    const text = taskText(ctx, title, `${detail}${ctx.payload.note ? `\n${ctx.payload.note}` : ''}`);
    // La vía del seguro de la comunidad titula la tarea con su acción, no con el título de la incidencia.
    if (ctx.payload.reason === 'open_insurance_claim') text.title = `${ctx.issue.ref} · ${title}`;
    return Promise.resolve(text);
  },
};

export const informRequester: TaskKindDefinition<
  InformRequesterPayload,
  InformRequesterResolution,
  InformRequesterResultRef
> = {
  kind: 'inform_requester',
  payload: InformRequesterPayload,
  resolution: InformRequesterResolution,
  resultRef: InformRequesterResultRef,
  build(ctx): Promise<TaskBuild> {
    const message = renderRequesterMessage(ctx.payload.template, {
      when: ctx.payload.when,
      label: ctx.payload.label,
    });
    return Promise.resolve({
      ...taskText(
        ctx,
        `Informar al solicitante: ${message.title}`,
        `Mensaje para el solicitante: «${message.body}»`,
      ),
      priority: 'BAJA',
    });
  },
};

export const approveQuote: TaskKindDefinition<
  ApproveQuotePayload,
  ApproveQuoteResolution,
  ApproveQuoteResultRef
> = {
  kind: 'approve_quote',
  payload: ApproveQuotePayload,
  resolution: ApproveQuoteResolution,
  resultRef: ApproveQuoteResultRef,
  async build(ctx): Promise<TaskBuild> {
    const name = await supplierName(ctx.db, ctx.payload.supplierId);
    return {
      ...taskText(
        ctx,
        `Aprobar presupuesto de ${euros(ctx.payload.amountCents)} €`,
        `Presupuesto de ${name}${ctx.payload.description ? `: ${ctx.payload.description}` : ''}.`,
      ),
      priority: ctx.issue.priority === 'Urgente' ? 'URGENTE' : 'ALTA',
    };
  },
};
