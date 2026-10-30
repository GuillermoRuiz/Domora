import type { AgendaTaskPriority, Prisma } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Cómo se resolvió una tarea de decisión. `resolving` es un valor TRANSITORIO:
 * marca que alguien está ejecutando la decisión y evita que dos personas la
 * resuelvan a la vez; una tarea terminada nunca lo conserva.
 */
export const TASK_OUTCOMES = [
  'approved',
  'rejected',
  'dismissed',
  'done',
  'superseded',
] as const;
export type TaskOutcome = (typeof TASK_OUTCOMES)[number];
export const RESOLVING_OUTCOME = 'resolving';

/** Cliente de Prisma o transacción: las mismas operaciones sirven en ambos. */
export type TaskDb = Prisma.TransactionClient;

export interface TaskBuildContext<P> {
  db: TaskDb;
  payload: P;
  issue: {
    id: string;
    ref: string;
    title: string;
    priority: 'Normal' | 'Urgente';
    estateId: string;
  };
}

export interface TaskBuild {
  title: string;
  description?: string;
  /** Si no se indica, se deriva de la urgencia de la incidencia. */
  priority?: AgendaTaskPriority;
}

export interface TaskResolveContext<P, R> {
  task: {
    id: string;
    kind: string;
    issueId: string;
    estateId: string;
    administratorId: string;
  };
  payload: P;
  resolution: R;
  user: AuthenticatedUser;
}

export interface TaskResolveResult<Ref> {
  outcome: Exclude<TaskOutcome, 'superseded'>;
  /** Qué se ejecutó al resolver; se valida con el esquema `resultRef` del tipo. */
  resultRef: Ref;
}

/** Constructor de una clase DTO (class-validator). */
export type DtoClass<T extends object> = new () => T;

/**
 * Definición de un tipo de tarea humana. Cada tipo declara TRES esquemas
 * explícitos —lo que se guarda al abrirla (`payload`), lo que envía la persona
 * al resolverla (`resolution`) y lo que queda guardado de lo ejecutado
 * (`resultRef`)—, para que la misma acción no acabe con estructuras distintas.
 */
export interface TaskKindDefinition<
  P extends object = object,
  R extends object = object,
  Ref extends object = object,
> {
  kind: string;
  payload: DtoClass<P>;
  resolution: DtoClass<R>;
  resultRef: DtoClass<Ref>;
  build(ctx: TaskBuildContext<P>): Promise<TaskBuild>;
  /** Sin `resolve`, el tipo existe (se puede abrir) pero aún no se resuelve desde la API. */
  resolve?(ctx: TaskResolveContext<P, R>): Promise<TaskResolveResult<Ref>>;
}
