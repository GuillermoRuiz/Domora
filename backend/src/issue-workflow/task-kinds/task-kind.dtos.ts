import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MinLength,
  ValidateIf,
  MaxLength,
  Min,
} from 'class-validator';

import { RESOLUTION_ROUTES } from '../resolution-routes';
import {
  REQUESTER_TEMPLATES,
  type RequesterTemplate,
} from '../requester-messages';

/**
 * Esquemas de las tareas humanas, UNO POR TIPO y por cada una de sus tres caras:
 *  - `…Payload`: lo que se guarda al abrir la tarea (`AgendaTask.payload`). Solo referencias y
 *    los datos mínimos de la decisión; nunca copias del contenido de un mensaje.
 *  - `…Resolution`: lo que envía la persona al resolverla (`POST /agenda/tasks/:id/resolution`).
 *  - `…ResultRef`: lo que queda guardado de lo ejecutado (`AgendaTask.resultRef`).
 * Se validan con `whitelist` y `forbidNonWhitelisted`: un campo que no está aquí se rechaza.
 */

export const REVIEW_ISSUE_REASONS = [
  /** Incidencia nueva que necesita una primera decisión de la gestión. */
  'new_issue',
  /** Novedad en una incidencia que se gestiona a mano. */
  'manual_review',
  'missing_provider',
  'notify_only',
  /** Incidencia abierta sin ninguna actuación prevista, pasado el margen. */
  'no_next_step',
  /** Siguiente actuación que una persona pidió al registrar una interacción. */
  'follow_up',
  /** La vía es el seguro de la comunidad y aún no hay siniestro: hay que abrirlo con la aseguradora. */
  'open_insurance_claim',
  /** La vía es el seguro del propietario: hay que pedirle que tramite el siniestro. */
  'ask_owner_file_claim',
  /** La aseguradora rechazó la cobertura: decidir cómo seguir (reclamar, reconsiderar, otra vía). */
  'claim_rejected',
  /** La vía es el proveedor de la comunidad: lo contacta una persona. */
  'contact_provider',
  /** La vía es «Administrador»: la gestión la lleva una persona y tiene que dejar su siguiente actuación. */
  'direct_management',
  /** Se registró el resultado de una visita y la incidencia no tiene otro siguiente paso: decidir cómo sigue. */
  'after_visit',
  /** El solicitante añadió una novedad al historial y nadie la ha mirado: UNA tarea abierta por incidencia, no una por nota. */
  'requester_update',
] as const;
// ── confirm_visit_outcome ───────────────────────────────────────────────
// Pasó la hora de una visita planificada y nadie dejó constancia de qué ocurrió: la administración lo confirma.

export class ConfirmVisitOutcomePayload {
  @IsUUID() visitId!: string;
}
export class ConfirmVisitOutcomeResolution {
  /**
   * `completed`: se realizó. `cancelled`: no se realizó o se canceló (no se presentó, se anuló…); si hace falta otra, se
   * programa una visita nueva. Que la visita se haya realizado NO resuelve la incidencia.
   */
  @IsIn(['completed', 'cancelled']) decision!: 'completed' | 'cancelled';
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
export class ConfirmVisitOutcomeResultRef {
  @IsIn(['completed', 'cancelled']) decision!: 'completed' | 'cancelled';
  @IsUUID() visitId!: string;
}

// ── chase_provider ──────────────────────────────────────────────────────
// Un proveedor lleva más de lo previsto sin responder.

export class ChaseProviderPayload {
  @IsUUID() waitId!: string;
  @IsOptional() @IsUUID() supplierId?: string;
}
export class ChaseProviderResolution {
  /**
   * `wait_more`: seguir esperando; `contacted`: la persona ya le ha reclamado por su cuenta y se
   * vuelve a esperar; `dismiss`: ya no se espera esa respuesta.
   */
  @IsIn(['wait_more', 'contacted', 'dismiss'])
  decision!: 'wait_more' | 'contacted' | 'dismiss';
  /** Horas hasta volver a avisar (por defecto, las del plazo habitual). */
  @IsOptional() @IsInt() @Min(1) @Max(720) extendHours?: number;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ChaseProviderResultRef {
  @IsIn(['wait_more', 'contacted', 'dismiss'])
  decision!: 'wait_more' | 'contacted' | 'dismiss';
  @IsUUID() waitId!: string;
  @IsOptional() @IsISO8601() nextDueAt?: string;
}

// ── review_issue ────────────────────────────────────────────────────────
// Una persona tiene que revisar la incidencia y fijar su siguiente paso.

export class ReviewIssuePayload {
  @IsIn(REVIEW_ISSUE_REASONS) reason!: (typeof REVIEW_ISSUE_REASONS)[number];
  /** Solo con `follow_up`: qué hay que hacer a continuación (texto de la persona). */
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** Hito del recorrido al que pertenece la tarea (id de un hito propio o clave de uno del sistema). */
  @IsOptional() @IsString() @MaxLength(60) milestone?: string;
}
/**
 * Qué se hace ahora con la incidencia. Una revisión NO se cierra a secas: toda decisión termina en un siguiente paso concreto
 * (o comprueba que ya lo hay), y si la incidencia sigue abierta sin ninguno la resolución se rechaza (409 `ISSUE_NO_NEXT_STEP`).
 *  - `choose_route`: decide (o cambia) la vía de gestión; la vía abre su propio trabajo (`route`).
 *  - `schedule_follow_up`: deja una próxima actuación con fecha (`note`, `dueAt`): una tarea de seguimiento.
 *  - `mark_resolved`: el problema está solucionado; la incidencia pasa a Resuelta (y se informa al solicitante si procede).
 *  - `next_step_exists`: no hace falta nada más porque ya hay otra tarea, espera o visita; se comprueba.
 *  - `done`: el valor histórico; equivale a `next_step_exists`.
 *  - `start_wait`: se queda esperando a un tercero (`party`, `partyLabel`, `dueInHours`): una espera abierta.
 *  - `schedule_visit`: hay una visita o actuación programada (`visitorLabel`, `scheduledAt`, `purpose`).
 *  - `completed`: alias heredado de `next_step_exists` (el botón genérico «Completada» ya no cierra una revisión): exige que
 *    ya haya otro siguiente paso.
 */
export const REVIEW_ISSUE_DECISIONS = [
  'choose_route',
  'schedule_follow_up',
  'mark_resolved',
  'start_wait',
  'schedule_visit',
  'next_step_exists',
  'done',
  'completed',
] as const;
export type ReviewIssueDecision = (typeof REVIEW_ISSUE_DECISIONS)[number];

export class ReviewIssueResolution {
  @IsIn(REVIEW_ISSUE_DECISIONS) decision!: ReviewIssueDecision;
  @ValidateIf((o: ReviewIssueResolution) => o.decision === 'choose_route')
  @IsIn(RESOLUTION_ROUTES)
  route?: (typeof RESOLUTION_ROUTES)[number];
  @ValidateIf((o: ReviewIssueResolution) => o.decision === 'schedule_follow_up')
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  note?: string;
  @ValidateIf((o: ReviewIssueResolution) => o.decision === 'schedule_follow_up')
  @IsISO8601()
  dueAt?: string;
  /** `schedule_follow_up`: responsable de su equipo y prioridad (mismas reglas que una tarea manual). */
  @IsOptional() @IsUUID() assigneeUserId?: string;
  @IsOptional() @IsIn(['URGENTE', 'ALTA', 'MEDIA', 'BAJA']) priority?: 'URGENTE' | 'ALTA' | 'MEDIA' | 'BAJA';
  /** `start_wait`: a quién se espera. */
  @ValidateIf((o: ReviewIssueResolution) => o.decision === 'start_wait')
  @IsIn(['provider', 'insurer', 'owner', 'other'])
  party?: 'provider' | 'insurer' | 'owner' | 'other';
  /** Con `supplierId` es opcional (el nombre sale del directorio): es el fallback cuando no se elige una entidad real. */
  @ValidateIf(
    (o: ReviewIssueResolution) =>
      (o.decision === 'start_wait' && !o.supplierId) || o.partyLabel !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  partyLabel?: string;
  /**
   * `start_wait` (proveedor o seguro) y `schedule_visit`: una entidad real del directorio de esta comunidad, en lugar de un
   * nombre suelto. Mismas reglas que «Registrar actividad».
   */
  @IsOptional() @IsUUID() supplierId?: string;
  /** `schedule_visit`: la visita es del profesional asignado a la incidencia (excluyente con `supplierId`). */
  @IsOptional() @IsBoolean() useAssignedProfessional?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(720) dueInHours?: number;
  /** `schedule_visit`: quién visita, cuándo y para qué. */
  /** Fallback de la visita: solo el nombre de quien visita (obligatorio si no se elige proveedor ni profesional asignado). */
  @ValidateIf(
    (o: ReviewIssueResolution) =>
      (o.decision === 'schedule_visit' && !o.supplierId && !o.useAssignedProfessional) ||
      o.visitorLabel !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  visitorLabel?: string;
  @ValidateIf((o: ReviewIssueResolution) => o.decision === 'schedule_visit')
  @IsISO8601()
  scheduledAt?: string;
  @IsOptional() @IsString() @MaxLength(200) purpose?: string;
}
export class ReviewIssueResultRef {
  @IsIn(REVIEW_ISSUE_DECISIONS) decision!: ReviewIssueDecision;
  @IsOptional() @IsIn(RESOLUTION_ROUTES) route?: (typeof RESOLUTION_ROUTES)[number];
  @IsOptional() @IsUUID() followUpTaskId?: string;
}

// ── approve_quote (esquema; la resolución llega con la fase de presupuestos) ──

export class ApproveQuotePayload {
  @IsUUID() supplierId!: string;
  /** Importe en céntimos, IVA incluido tal como lo da el proveedor. */
  @IsInt() @Min(0) @Max(100_000_000_00) amountCents!: number;
  @IsIn(['EUR']) currency!: 'EUR';
  @IsOptional() @IsString() @MaxLength(300) description?: string;
}
export class ApproveQuoteResolution {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
}
export class ApproveQuoteResultRef {
  @IsIn(['approve', 'reject']) decision!: 'approve' | 'reject';
  @IsInt() @Min(0) amountCents!: number;
}

// ── inform_requester ────────────────────────────────────────────────────
// Una persona informa al solicitante con una plantilla de hechos o descarta el aviso.

export class InformRequesterPayload {
  @IsIn(REQUESTER_TEMPLATES) template!: RequesterTemplate;
  /** ISO 8601: cuándo (la visita). */
  @IsOptional() @IsISO8601() when?: string;
  @IsOptional() @IsString() @MaxLength(200) label?: string;
}
export class InformRequesterResolution {
  @IsIn(['send', 'dismiss']) decision!: 'send' | 'dismiss';
}
export class InformRequesterResultRef {
  @IsIn(['send', 'dismiss']) decision!: 'send' | 'dismiss';
  @IsOptional() @IsBoolean() sent?: boolean;
}
