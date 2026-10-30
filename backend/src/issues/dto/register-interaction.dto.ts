import type { AgendaTaskPriority } from '../../prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  ISSUE_WAIT_KINDS,
  type IssueWaitKind,
} from '../../issue-workflow/issue-wait-kinds';
import {
  RESOLUTION_ROUTES,
  type ResolutionRoute,
} from '../../issue-workflow/resolution-routes';
import {
  CUSTOM_REQUESTER_TEXT_MAX,
  MANUAL_REQUESTER_TEMPLATES,
  type RequesterTemplate,
} from '../../issue-workflow/requester-messages';
import {
  CLAIM_STATUSES,
  type ClaimStatus,
} from '../../issue-workflow/insurance-claims';

export const INTERACTION_CHANNELS = [
  'phone',
  'whatsapp',
  'email',
  'in_person',
  'other',
] as const;
export const INTERACTION_DIRECTIONS = ['outbound', 'inbound'] as const;
export const INTERACTION_PARTIES = [
  'provider',
  'insurer',
  'owner',
  'requester',
  'other',
] as const;
export const MAX_INTERACTION_EFFECTS = 5;
export const AGENDA_TASK_PRIORITIES = [
  'URGENTE',
  'ALTA',
  'MEDIA',
  'BAJA',
] as const satisfies readonly AgendaTaskPriority[];

/**
 * «¿Qué pasa ahora?»: cómo sigue la incidencia tras esta interacción. Cada opción exige el efecto que la materializa
 * (tarea, espera, visita, vía, resolución) y, salvo `resolved`, la incidencia tiene que quedar con un siguiente paso real.
 * `none` solo vale si ya hay otro (tarea, espera, visita o trabajo de Domora) que lo explique.
 */
export const INTERACTION_NEXT_STEPS = [
  'task',
  'wait',
  'visit',
  'route',
  'resolved',
  'none',
] as const;
export type InteractionNextStep = (typeof INTERACTION_NEXT_STEPS)[number];

/**
 * Una comunicación externa o manual (llamada, WhatsApp, email, reunión) y, opcionalmente, las consecuencias
 * que de ella se derivan. Las consecuencias son una lista CERRADA de efectos tipados (cada uno con su esquema
 * estricto, abajo): el cliente solo indica que de la conversación se deriva algo; el servidor valida que sea
 * compatible con el estado actual y lo ejecuta, todo o nada.
 */
export class RegisterInteractionDto {
  @IsIn(INTERACTION_CHANNELS) channel!: (typeof INTERACTION_CHANNELS)[number];
  @IsIn(INTERACTION_DIRECTIONS)
  direction!: (typeof INTERACTION_DIRECTIONS)[number];
  @IsIn(INTERACTION_PARTIES) party!: (typeof INTERACTION_PARTIES)[number];
  /** Cómo se llama el interlocutor («Mapfre», «Ascensores Levante», «la propietaria del 3ºB»). */
  @IsOptional() @IsString() @MaxLength(200) partyLabel?: string;
  /** Proveedor del directorio de la comunidad (proveedor o aseguradora con categoría «Seguros»). */
  @IsOptional() @IsUUID() supplierId?: string;
  @IsString() @MinLength(1) @MaxLength(1000) summary!: string;
  /** Cuándo ocurrió; por defecto, ahora. */
  @IsOptional() @IsISO8601() occurredAt?: string;
  /** Referencia que dio el tercero (p. ej. nº de siniestro). Queda en el rastro; no crea ninguna entidad. */
  @IsOptional() @IsString() @MaxLength(100) claimRef?: string;
  /** Efectos solicitados; se validan uno a uno contra su esquema (`EFFECT_SCHEMAS`). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_INTERACTION_EFFECTS)
  effects?: unknown[];
  /**
   * Cómo sigue la incidencia (ver `INTERACTION_NEXT_STEPS`): obligatorio en la gestión. El servidor comprueba que los efectos
   * la respalden y que la incidencia no quede sin siguiente paso.
   */
  @IsOptional() @IsIn(INTERACTION_NEXT_STEPS) nextStep?: InteractionNextStep;
  /**
   * COMPATIBILIDAD, deprecado: una integración anterior que no sabe indicar `nextStep` lo declara así, de forma explícita. El
   * contrato normal de la gestión es `nextStep` obligatorio; sin ninguno de los dos, el endpoint responde 400
   * `NEXT_STEP_REQUIRED`. Los avisos al solicitante (`party = requester`) no cambian el rumbo de la incidencia y no lo exigen.
   */
  @IsOptional() @IsBoolean() legacyNoNextStep?: boolean;
}

export class EndWaitEffect {
  @IsIn(['end_wait']) type!: 'end_wait';
  @IsUUID() waitId!: string;
  @IsIn(['fulfilled', 'cancelled']) reason!: 'fulfilled' | 'cancelled';
}
export class StartWaitEffect {
  @IsIn(['start_wait']) type!: 'start_wait';
  @IsIn(ISSUE_WAIT_KINDS) kind!: IssueWaitKind;
  /** Proveedor o aseguradora del directorio. Para el propietario u otros, basta `partyLabel`. */
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(200) partyLabel?: string;
  /** En cuántas horas volver a mirar; por defecto, el plazo de la política de seguimiento. */
  @IsOptional() @IsInt() @Min(1) @Max(720) dueInHours?: number;
  /**
   * Solo con `insurer_reply`: el siniestro por el que se espera. Con un único siniestro vivo se usa ese; con varios es
   * obligatorio (no se infiere).
   */
  @IsOptional() @IsUUID() claimId?: string;
}
export class ScheduleVisitEffect {
  @IsIn(['schedule_visit']) type!: 'schedule_visit';
  /**
   * Proveedor del directorio. Sin él, la visita es del profesional asignado a la incidencia (que puede no ser proveedor
   * de la comunidad, p. ej. el que envía una aseguradora).
   */
  @IsOptional() @IsUUID() supplierId?: string;
  /**
   * Quién hace la visita cuando no es un proveedor del directorio: su nombre, sin darlo de alta («la propietaria del 3ºB»).
   * Sin `supplierId` ni `visitorLabel`, la visita es del profesional asignado a la incidencia.
   */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) visitorLabel?: string;
  @IsISO8601() scheduledAt!: string;
  @IsOptional() @IsString() @MaxLength(200) purpose?: string;
}
export class OpenFollowUpEffect {
  @IsIn(['open_follow_up']) type!: 'open_follow_up';
  /** Qué hay que hacer: es la acción que se ve en la tarea. */
  @IsString() @MinLength(1) @MaxLength(300) note!: string;
  /** Responsable, de su equipo (misma regla que una tarea manual). Sin él, sin asignar. */
  @IsOptional() @IsUUID() assigneeUserId?: string;
  @IsOptional() @IsIn(AGENDA_TASK_PRIORITIES) priority?: AgendaTaskPriority;
  /** Cuándo toca: la tarea de seguimiento aparece en Tareas en ese momento. Sin fecha, el plazo habitual de la tarea. */
  @IsOptional() @IsISO8601() dueAt?: string;
  /** A qué hito del recorrido pertenece la tarea: obligatorio (id de un hito propio o clave de uno del sistema). */
  @IsString() @MinLength(1) @MaxLength(60) milestone!: string;
}
export class SetResolutionRouteEffect {
  @IsIn(['set_resolution_route']) type!: 'set_resolution_route';
  @IsIn(RESOLUTION_ROUTES) route!: ResolutionRoute;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class InformRequesterEffect {
  @IsIn(['inform_requester']) type!: 'inform_requester';
  @IsIn(MANUAL_REQUESTER_TEMPLATES) template!: RequesterTemplate;
  @IsOptional() @IsISO8601() when?: string;
  @IsOptional() @IsString() @MaxLength(200) label?: string;
  /** Solo con la plantilla `custom`: el mensaje que escribe la gestión. */
  @IsOptional() @IsString() @MaxLength(CUSTOM_REQUESTER_TEXT_MAX) text?: string;
}
export class ResolveIssueEffect {
  @IsIn(['resolve_issue']) type!: 'resolve_issue';
}
/** Abre un siniestro de seguro en la incidencia (la aseguradora es del directorio o solo un nombre). */
export class OpenClaimEffect {
  @IsIn(['open_claim']) type!: 'open_claim';
  @IsOptional() @IsUUID() insurerSupplierId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) insurerName?: string;
  @IsOptional() @IsUUID() contractId?: string;
  @IsOptional() @IsString() @MaxLength(50) policyNumber?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(200) contactName?: string;
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string;
}
/** Cambia el siniestro: su referencia, su estado o sus datos de contacto. */
export class UpdateClaimEffect {
  @IsIn(['update_claim']) type!: 'update_claim';
  /** Obligatorio si hay varios siniestros vivos. */
  @IsOptional() @IsUUID() claimId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) reference?: string;
  @IsOptional() @IsIn(CLAIM_STATUSES) status?: ClaimStatus;
  @IsOptional() @IsString() @MaxLength(200) contactName?: string;
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(50) policyNumber?: string;
}
/**
 * Asigna un profesional a la incidencia: del directorio (`supplierId`) o solo por nombre (no se da de alta como
 * proveedor). Con `byInsurer` o `claimId`, lo envía la aseguradora por ese siniestro.
 */
export class AssignProviderEffect {
  @IsIn(['assign_provider']) type!: 'assign_provider';
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsBoolean() byInsurer?: boolean;
  @IsOptional() @IsUUID() claimId?: string;
}

export type InteractionEffect =
  | EndWaitEffect
  | StartWaitEffect
  | ScheduleVisitEffect
  | OpenFollowUpEffect
  | SetResolutionRouteEffect
  | InformRequesterEffect
  | ResolveIssueEffect
  | OpenClaimEffect
  | UpdateClaimEffect
  | AssignProviderEffect;

/** Esquema estricto de cada efecto, por su `type`. Un `type` que no está aquí se rechaza. */
export const EFFECT_SCHEMAS = {
  end_wait: EndWaitEffect,
  start_wait: StartWaitEffect,
  schedule_visit: ScheduleVisitEffect,
  open_follow_up: OpenFollowUpEffect,
  set_resolution_route: SetResolutionRouteEffect,
  inform_requester: InformRequesterEffect,
  resolve_issue: ResolveIssueEffect,
  open_claim: OpenClaimEffect,
  update_claim: UpdateClaimEffect,
  assign_provider: AssignProviderEffect,
} as const;
export type InteractionEffectType = keyof typeof EFFECT_SCHEMAS;

/** Lo mismo que el efecto `inform_requester`, para ver el texto exacto ANTES de enviarlo. */
export class PreviewRequesterNoticeDto {
  @IsIn(MANUAL_REQUESTER_TEMPLATES) template!: RequesterTemplate;
  @IsOptional() @IsISO8601() when?: string;
  @IsOptional() @IsString() @MaxLength(200) label?: string;
  @IsOptional() @IsString() @MaxLength(CUSTOM_REQUESTER_TEXT_MAX) text?: string;
}

/** Correcciones y cambios de estado de un siniestro que no vienen de una comunicación (`PATCH …/insurance-claims/:id`). */
export class UpdateInsuranceClaimDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) reference?: string;
  @IsOptional() @IsIn(CLAIM_STATUSES) status?: ClaimStatus;
  @IsOptional() @IsString() @MaxLength(200) contactName?: string;
  @IsOptional() @IsString() @MaxLength(30) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(50) policyNumber?: string;
}

/**
 * El resultado de una visita planificada, desde la incidencia: se realizó o no llegó a hacerse (cancelada). Que se haya
 * realizado NO resuelve la incidencia.
 */
export class RecordVisitOutcomeDto {
  @IsIn(['completed', 'cancelled']) outcome!: 'completed' | 'cancelled';
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

/** Nueva hora de una visita planificada (ISO). Tiene que ser futura. */
export class RescheduleVisitDto {
  @IsISO8601() scheduledAt!: string;
}

export class SetResolutionRouteDto {
  /** `null` = volver a «sin decidir». */
  @IsOptional()
  @IsIn([...RESOLUTION_ROUTES, null])
  route!: ResolutionRoute | null;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
