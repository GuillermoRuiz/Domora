import { Injectable } from '@nestjs/common';
import type {
  ActorKind,
  IssueStatus,
  Prisma,
  TimelineAuthorRole,
} from '../prisma/client';
import {
  defaultRoleFor,
  isVisibleToRequester,
  type IssueEventKind,
} from './issue-event-kinds';

export interface IssueEventInput {
  issueId: string;
  kind: IssueEventKind;
  /** Qué actuó: persona, IA, sistema (regla/cron) o un tercero. */
  actorKind: ActorKind;
  text: string;
  /** Solo con `actorKind = person`. */
  authorUserId?: string | null;
  /** Papel en el historial; por defecto, según `actorKind`. */
  role?: TimelineAuthorRole;
  /** Puntero al artefacto concreto (nunca su contenido). */
  refType?: string;
  refId?: string;
  /** Detalle técnico (modelo, regla aplicada…); solo lo ve la gestión. */
  meta?: Prisma.InputJsonValue;
  fromStatus?: IssueStatus;
  toStatus?: IssueStatus;
  /** Solo puede RESTRINGIR: un evento solo es visible si su tipo está en la lista blanca (`REQUESTER_VISIBLE_EVENT_KINDS`). */
  internal?: boolean;
  date?: Date;
}

/** Lo único que hace falta del cliente: sirve igual una transacción que el cliente normal. */
export type IssueEventDb = Pick<Prisma.TransactionClient, 'issueTimelineEntry'>;

/**
 * Datos de una fila del historial. Función pura: la usan tanto `record` como
 * las creaciones anidadas (`timeline: { create: … }`) de otros servicios.
 */
export function issueEventData(
  input: Omit<IssueEventInput, 'issueId'>,
): Omit<Prisma.IssueTimelineEntryUncheckedCreateInput, 'issueId'> {
  if (input.actorKind === 'person' && !input.authorUserId) {
    // Una persona sin identificar rompería la auditoría que este historial existe para dar.
    throw new Error('ISSUE_EVENT_PERSON_WITHOUT_AUTHOR');
  }
  return {
    date: input.date ?? new Date(),
    kind: input.kind,
    actorKind: input.actorKind,
    authorUserId: input.authorUserId ?? null,
    role: input.role ?? defaultRoleFor(input.actorKind),
    text: input.text,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    meta: input.meta,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    internal:
      input.internal === true ||
      !isVisibleToRequester(input.kind, input.actorKind),
  };
}

/**
 * Único escritor del historial de una incidencia (evento = lo que ocurrió).
 * Las tareas y las esperas viven en sus propias tablas; aquí solo queda el rastro.
 */
@Injectable()
export class IssueEventsService {
  record(db: IssueEventDb, input: IssueEventInput) {
    return db.issueTimelineEntry.create({
      data: { issueId: input.issueId, ...issueEventData(input) },
    });
  }
}
