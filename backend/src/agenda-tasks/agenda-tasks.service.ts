import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgendaTaskPriority,
  AgendaTaskStatus,
  AgendaTaskType,
  Prisma,
  TaskCreatorKind,
} from '../prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { AuditService } from '../gdpr/audit.service';
import { StorageService } from '../files/storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  DEFAULT_LABELS,
  DEFAULT_LIST_LIMIT,
  MANUAL_SOURCE,
  MAX_RANGE_DAYS,
  MAX_RANGE_ITEMS,
  MAX_TASK_DURATION_DAYS,
  OPEN_STATUSES,
  isOverdue,
  isTerminal,
} from './agenda-task.constants';
import type {
  AgendaSummary,
  AgendaTaskDetail,
  AgendaTaskList,
  AgendaTaskView,
  PersonRef,
} from './agenda-task.types';
import {
  AgendaTaskLinksService,
  type StoredLinkRef,
} from './agenda-task-links.service';
import {
  calendarDayRange,
  firstStartingFrom,
  isOccurrenceStart,
  isValidTimezone,
  localMidnightOf,
  occurrenceAt,
  occurrenceIndexOf,
  occurrenceOverlaps,
  occurrencesBetween,
  seriesSpecOf,
  type Occurrence,
  type SeriesRow,
} from './recurrence';
import type {
  CreateAgendaTaskDto,
  RecurrenceDto,
} from './dto/create-agenda-task.dto';
import type { UpdateAgendaTaskDto } from './dto/update-agenda-task.dto';
import type {
  AgendaSummaryQueryDto,
  ListAgendaTasksQueryDto,
  UpdateTaskStatusDto,
} from './dto/misc.dto';
import { assertTeamAssignee } from './agenda-task-assignee';
import { issueEventData } from '../issue-workflow/issue-events.service';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_TIMEZONE = 'Europe/Madrid';
/** Hasta dónde se busca la próxima ocurrencia de una serie en las listas sin rango. */
const NEXT_OCCURRENCE_HORIZON_DAYS = 400;
/** Tope de ocurrencias expandidas por consulta de calendario (protege de series masivas). */
const MAX_RANGE_OCCURRENCES = 5_000;
/**
 * El "fin de día" de una tarea de día completo es la medianoche LOCAL de su
 * zona: entre 14 h antes (UTC+14) y 12 h después (UTC−12) de la medianoche UTC
 * que guarda la base de datos. Fuera de esa banda su vencimiento es seguro.
 */
const ALL_DAY_DEADLINE_EARLIEST_MS = 14 * HOUR_MS;
const ALL_DAY_DEADLINE_LATEST_MS = 12 * HOUR_MS;

/** Trabajo sin resolver: ni completado ni cancelado (en positivo: ver `OPEN_STATUSES`). */
const OPEN_WHERE: Prisma.AgendaTaskWhereInput = {
  status: { in: OPEN_STATUSES },
};

/** Tope de tareas de incidencias futuras que se añaden a una consulta de rango. */
const MAX_UPCOMING_ISSUE_TASKS = 200;

const PERSON = { select: { id: true, fullName: true } } as const;

/** Lo que necesita el calendario de cada tarea: sin textos largos ni colecciones pesadas. */
const LIST_INCLUDE = {
  estate: { select: { id: true, name: true } },
  assignedTo: PERSON,
  labels: { select: { label: { select: { id: true, name: true } } } },
  checklist: { select: { done: true } },
  _count: { select: { comments: true, attachments: true, links: true } },
} satisfies Prisma.AgendaTaskInclude;

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  checklist: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
  comments: { orderBy: { createdAt: 'asc' }, include: { author: PERSON } },
  attachments: { orderBy: { createdAt: 'asc' } },
  links: true,
  createdBy: PERSON,
} satisfies Prisma.AgendaTaskInclude;

type DetailRow = Prisma.AgendaTaskGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

/** Resolución individual de una ocurrencia (`agenda_task_occurrences`). */
interface ResolvedOccurrence {
  occurrenceStart: Date;
  /** Fin congelado al resolverla (ver `AgendaTaskOccurrence.occurrenceEnd`). */
  occurrenceEnd?: Date | null;
  status: AgendaTaskStatus;
}

/** Campos necesarios para expandir una fila en ocurrencias con su estado efectivo. */
interface ExpandableRow extends SeriesRow {
  status: AgendaTaskStatus;
  dueAt?: Date | null;
  occurrences?: ResolvedOccurrence[];
}

/** Lo mínimo que necesita `toView`: sirve tanto para filas de lista como de detalle. */
interface ViewRow extends ExpandableRow {
  id: string;
  title: string;
  estate: { id: string; name: string } | null;
  assignedTo: PersonRef | null;
  type: AgendaTaskType;
  priority: AgendaTaskPriority;
  noDuration: boolean;
  reminderMinutesBefore: number | null;
  source: string;
  createdByUserId: string | null;
  createdByKind: TaskCreatorKind;
  issueId: string | null;
  kind: string | null;
  labels: { label: { id: string; name: string } }[];
  checklist: { done: boolean }[];
  _count: { comments: number; attachments: number; links: number };
}

/** Una ocurrencia concreta de una tarea, con su estado efectivo y su fin real. */
interface ExpandedOccurrence {
  occurrence: Occurrence;
  /** Estado de ESTA ocurrencia (la resolución individual manda sobre la de la serie). */
  status: AgendaTaskStatus;
  /** Instante en que vence: `dueAt` si la tarea tiene plazo propio; si no, el fin, o la medianoche local si es de día completo. */
  deadline: Date;
  allDay: boolean;
}

interface Filters {
  estateId?: string;
  assignee?: string;
  status?: AgendaTaskStatus[];
  priority?: AgendaTaskPriority[];
  type?: AgendaTaskType[];
  labelIds?: string[];
  q?: string;
  overdue: boolean;
}

/** Una tarea con hora ya vencida: su plazo propio (`dueAt`) o, si no tiene, el fin de su bloque. */
function timedOverdue(before: Date): Prisma.AgendaTaskWhereInput {
  return {
    allDay: false,
    OR: [{ dueAt: { lt: before } }, { dueAt: null, endAt: { lt: before } }],
  };
}

function utcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function parseDate(raw: string, field: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Fecha inválida en "${field}".`);
  }
  return date;
}

function parseCsv<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  field: string,
): T[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) return undefined;
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new BadRequestException(`Valor inválido en "${field}": ${value}.`);
    }
  }
  return values as T[];
}

@Injectable()
export class AgendaTasksService {
  private readonly logger = new Logger(AgendaTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly audit: AuditService,
    private readonly links: AgendaTaskLinksService,
    private readonly storage: StorageService,
  ) {}

  // ── Ámbito (multi-tenant) ───────────────────────────────────────────────

  /** El tenant es la gestora del usuario; sin ella no hay agenda. */
  private adminId(user: AuthenticatedUser): string {
    if (!user.administratorId) {
      throw new ForbiddenException(
        'Tu usuario no pertenece a ninguna gestora.',
      );
    }
    return user.administratorId;
  }

  /**
   * Todas las consultas parten de aquí: tareas de LA gestora y, de ellas,
   * las generales (sin comunidad) o de comunidades accesibles al usuario.
   */
  private scopeWhere(user: AuthenticatedUser): Prisma.AgendaTaskWhereInput {
    return {
      administratorId: this.adminId(user),
      // Las archivadas (p. ej. las de una incidencia borrada) se conservan para la auditoría pero no son agenda.
      archivedAt: null,
      OR: [{ estateId: null }, { estateId: { in: user.estateIds } }],
    };
  }

  /** Carga una tarea dentro del ámbito del usuario o lanza 404. */
  private async findScoped(id: string, user: AuthenticatedUser) {
    if (!isUUID(id)) throw new NotFoundException('Tarea no encontrada.');
    const task = await this.prisma.agendaTask.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: { links: true, labels: true },
    });
    if (!task) throw new NotFoundException('Tarea no encontrada.');
    return task;
  }

  /** Verifica el acceso y devuelve la tarea (uso por los servicios hermanos). */
  async assertAccess(id: string, user: AuthenticatedUser) {
    return this.findScoped(id, user);
  }

  // ── Consulta ────────────────────────────────────────────────────────────

  async list(
    user: AuthenticatedUser,
    query: ListAgendaTasksQueryDto,
  ): Promise<AgendaTaskList> {
    const filters = this.parseFilters(query);
    const tz = this.normalizeTimezone(query.tz);
    const now = new Date();

    if (query.from && query.to) {
      const from = parseDate(query.from, 'from');
      const to = parseDate(query.to, 'to');
      return this.rangeItems(user, filters, from, to, tz, now);
    }
    if (query.from || query.to) {
      throw new BadRequestException(
        'Indica ambos límites del rango: from y to.',
      );
    }
    return this.openItems(
      user,
      filters,
      query.limit ?? DEFAULT_LIST_LIMIT,
      tz,
      now,
    );
  }

  async summary(
    user: AuthenticatedUser,
    query: AgendaSummaryQueryDto,
  ): Promise<AgendaSummary> {
    const now = new Date();
    const tz = this.normalizeTimezone(query.tz);
    const dayFrom = parseDate(query.dayFrom, 'dayFrom');
    const dayTo = parseDate(query.dayTo, 'dayTo');
    const weekFrom = parseDate(query.weekFrom, 'weekFrom');
    const weekTo = parseDate(query.weekTo, 'weekTo');
    this.assertRange(dayFrom, dayTo);
    this.assertRange(weekFrom, weekTo);
    const filters: Filters = {
      estateId: query.estateId,
      assignee: query.assignee,
      overdue: false,
    };

    const week = (
      await this.summaryOccurrences(user, filters, weekFrom, weekTo, tz)
    ).filter((o) => !isTerminal(o.status));
    const dayInstants = { from: dayFrom, to: dayTo };
    const dayDates = calendarDayRange(dayFrom, dayTo, tz);
    const today = week.filter((o) => {
      const range = o.allDay ? dayDates : dayInstants;
      return occurrenceOverlaps(o.occurrence, range.from, range.to);
    });

    const base = await this.filtersWhere(user, filters);
    const [urgent, overdue] = await Promise.all([
      this.countUrgent(user, base, now),
      this.countOverdue(user, base, now),
    ]);
    return { today: today.length, week: week.length, urgent, overdue };
  }

  async getById(
    id: string,
    user: AuthenticatedUser,
  ): Promise<AgendaTaskDetail> {
    if (!isUUID(id)) throw new NotFoundException('Tarea no encontrada.');
    const row = await this.prisma.agendaTask.findFirst({
      where: { AND: [{ id }, this.scopeWhere(user)] },
      include: DETAIL_INCLUDE,
    });
    if (!row) throw new NotFoundException('Tarea no encontrada.');
    return this.toDetail(row, user);
  }

  private assertRange(from: Date, to: Date): void {
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException(
        'El rango es inválido: "to" debe ser posterior a "from".',
      );
    }
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `El rango máximo es de ${MAX_RANGE_DAYS} días.`,
      );
    }
  }

  /**
   * Condición de BD de "tareas que pueden tener ocurrencias en [from, to)". Se
   * ensancha un día por cada lado porque las tareas de día completo se
   * comparan por fecha de calendario (la zona del cliente puede desplazar el
   * rango hasta ±14 h); el recorte exacto se hace después en memoria.
   */
  private rangeWhere(from: Date, to: Date): Prisma.AgendaTaskWhereInput {
    const lo = new Date(from.getTime() - DAY_MS);
    const hi = new Date(to.getTime() + DAY_MS);
    // Ninguna tarea dura más de MAX_TASK_DURATION_DAYS (lo garantiza un CHECK de la
    // BD), así que una puntual que empezó antes de esto no puede solaparse: esa cota
    // permite usar el índice (gestora, inicio) en lugar de recorrer todo el histórico.
    const earliestStart = new Date(
      lo.getTime() - (MAX_TASK_DURATION_DAYS + 1) * DAY_MS,
    );
    return {
      OR: [
        {
          recurrenceFreq: null,
          startAt: { gte: earliestStart, lt: hi },
          endAt: { gte: lo },
        },
        {
          recurrenceFreq: { not: null },
          startAt: { lt: hi },
          OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: lo } }],
        },
      ],
    };
  }

  /** Resoluciones de ocurrencias que pueden afectar al rango (mismo ensanche). */
  private occurrencesSelect(from: Date, to: Date) {
    return {
      where: {
        occurrenceStart: {
          gte: new Date(from.getTime() - DAY_MS),
          lt: new Date(to.getTime() + DAY_MS),
        },
      },
      select: { occurrenceStart: true, occurrenceEnd: true, status: true },
    } as const;
  }

  /**
   * Ocurrencias de una fila que solapan con [from, to). Las tareas de día
   * completo se comparan por fecha de calendario en la zona del cliente.
   */
  private expand(
    row: ExpandableRow,
    from: Date,
    to: Date,
    tz: string,
  ): ExpandedOccurrence[] {
    const window = row.allDay ? calendarDayRange(from, to, tz) : { from, to };
    const spec = seriesSpecOf(row);
    const live = occurrencesBetween(spec, window.from, window.to);
    // Lo ya resuelto es historia: si la serie se editó después, esas ocurrencias siguen donde ocurrieron aunque la serie nueva
    // ya no las genere (p. ej. los lunes completados de una serie que pasó a los martes).
    const frozen = row.recurrenceFreq
      ? (row.occurrences ?? [])
          .filter(
            (o) =>
              !live.some(
                (l) => l.start.getTime() === o.occurrenceStart.getTime(),
              ) && !isOccurrenceStart(spec, o.occurrenceStart),
          )
          .map((o): Occurrence => ({
            start: o.occurrenceStart,
            end:
              o.occurrenceEnd ??
              new Date(
                o.occurrenceStart.getTime() +
                  (row.endAt.getTime() - row.startAt.getTime()),
              ),
          }))
          .filter((o) => occurrenceOverlaps(o, window.from, window.to))
      : [];
    return [...live, ...frozen]
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .map((occurrence) => this.resolve(row, occurrence));
  }

  private resolve(
    row: ExpandableRow,
    occurrence: Occurrence,
  ): ExpandedOccurrence {
    const resolved = row.recurrenceFreq
      ? row.occurrences?.find(
          (o) => o.occurrenceStart.getTime() === occurrence.start.getTime(),
        )
      : undefined;
    return {
      occurrence,
      status: resolved?.status ?? row.status,
      // Día completo: vence a medianoche LOCAL de su zona, no a la UTC.
      deadline:
        !row.recurrenceFreq && row.dueAt
          ? row.dueAt
          : row.allDay
            ? localMidnightOf(occurrence.end, row.timezone)
            : occurrence.end,
      allDay: row.allDay,
    };
  }

  /** Consulta de calendario: ocurrencias que solapan con [from, to). */
  private async rangeItems(
    user: AuthenticatedUser,
    filters: Filters,
    from: Date,
    to: Date,
    tz: string,
    now: Date,
  ): Promise<AgendaTaskList> {
    this.assertRange(from, to);

    const rows = await this.prisma.agendaTask.findMany({
      where: {
        AND: [
          this.scopeWhere(user),
          this.rangeWhere(from, to),
          ...(await this.filtersWhere(user, filters)),
        ],
      },
      include: {
        ...LIST_INCLUDE,
        occurrences: this.occurrencesSelect(from, to),
      },
      // El calendario no necesita el texto largo: solo el detalle lo carga.
      omit: { description: true },
      orderBy: { startAt: 'asc' },
      take: MAX_RANGE_ITEMS,
    });
    let truncated = rows.length === MAX_RANGE_ITEMS;
    if (truncated) {
      this.logger.warn(
        `Consulta de agenda truncada a ${MAX_RANGE_ITEMS} tareas (gestora ${this.adminId(user)}).`,
      );
    }

    const items: AgendaTaskView[] = [];
    for (const row of rows) {
      for (const expanded of this.expand(row, from, to, tz)) {
        const view = this.toView(row, expanded, now);
        if (this.matchesEffective(view, filters)) items.push(view);
      }
      if (items.length >= MAX_RANGE_OCCURRENCES) {
        truncated = true;
        this.logger.warn(
          `Consulta de agenda truncada a ${MAX_RANGE_OCCURRENCES} ocurrencias (gestora ${this.adminId(user)}).`,
        );
        break;
      }
    }
    items.push(...(await this.upcomingIssueTasks(user, filters, to, now)));
    items.sort(
      (a, b) =>
        a.occurrenceStart.localeCompare(b.occurrenceStart) ||
        a.title.localeCompare(b.title),
    );
    return { items, truncated };
  }

  /**
   * Tareas abiertas de incidencias cuyo vencimiento cae después del rango: la tabla y el tablero las enseñan igualmente
   * (la gente las tiene pendientes desde que se abren) y el calendario las marca como «pendientes» arriba. Son siempre
   * puntuales; las filtra lo mismo que al resto.
   */
  private async upcomingIssueTasks(
    user: AuthenticatedUser,
    filters: Filters,
    to: Date,
    now: Date,
  ): Promise<AgendaTaskView[]> {
    const rows = await this.prisma.agendaTask.findMany({
      where: {
        AND: [
          this.scopeWhere(user),
          ...(await this.filtersWhere(user, filters)),
          OPEN_WHERE,
          { source: 'issue', recurrenceFreq: null, startAt: { gte: to } },
        ],
      },
      include: { ...LIST_INCLUDE, occurrences: false },
      omit: { description: true },
      orderBy: { startAt: 'asc' },
      take: MAX_UPCOMING_ISSUE_TASKS,
    });
    const views: AgendaTaskView[] = [];
    for (const row of rows) {
      const view = this.toView(
        row,
        this.resolve(row, { start: row.startAt, end: row.endAt }),
        now,
      );
      if (this.matchesEffective(view, filters)) views.push(view);
    }
    return views;
  }

  /**
   * Ocurrencias del rango para los KPI. Misma expansión que el calendario pero
   * solo con las columnas que hacen falta para contar: nada de etiquetas,
   * checklist, responsables ni contadores.
   */
  private async summaryOccurrences(
    user: AuthenticatedUser,
    filters: Filters,
    from: Date,
    to: Date,
    tz: string,
  ): Promise<ExpandedOccurrence[]> {
    const rows = await this.prisma.agendaTask.findMany({
      where: {
        AND: [
          this.scopeWhere(user),
          this.rangeWhere(from, to),
          ...(await this.filtersWhere(user, filters)),
        ],
      },
      select: {
        status: true,
        startAt: true,
        endAt: true,
        allDay: true,
        timezone: true,
        recurrenceFreq: true,
        recurrenceInterval: true,
        recurrenceUntil: true,
        occurrences: this.occurrencesSelect(from, to),
      },
      orderBy: { startAt: 'asc' },
      take: MAX_RANGE_ITEMS,
    });
    if (rows.length === MAX_RANGE_ITEMS) {
      this.logger.warn(
        `Resumen de agenda calculado sobre un máximo de ${MAX_RANGE_ITEMS} tareas (gestora ${this.adminId(user)}): el recuento puede ser parcial.`,
      );
    }
    return rows.flatMap((row) => this.expand(row, from, to, tz));
  }

  /**
   * Lista de trabajo ABIERTO sin rango (vencidas, urgentes…). Nunca devuelve
   * el histórico: solo tareas sin completar/cancelar, con tope de filas.
   */
  private async openItems(
    user: AuthenticatedUser,
    filters: Filters,
    limit: number,
    tz: string,
    now: Date,
  ): Promise<AgendaTaskList> {
    const extra: Prisma.AgendaTaskWhereInput[] = [
      OPEN_WHERE,
      this.notFinishedSeries(now),
    ];
    if (filters.overdue) {
      // Prefiltro de BD (las series no cuentan como vencidas); el vencimiento
      // exacto de las de día completo se remata en memoria con su zona.
      extra.push({
        recurrenceFreq: null,
        OR: [
          timedOverdue(now),
          {
            allDay: true,
            endAt: {
              lt: new Date(now.getTime() + ALL_DAY_DEADLINE_EARLIEST_MS),
            },
          },
        ],
      });
    }
    const rows = await this.prisma.agendaTask.findMany({
      where: {
        AND: [
          this.scopeWhere(user),
          ...(await this.filtersWhere(user, filters)),
          ...extra,
        ],
      },
      include: {
        ...LIST_INCLUDE,
        occurrences: {
          where: { occurrenceStart: { gte: new Date(now.getTime() - DAY_MS) } },
          select: { occurrenceStart: true, status: true },
        },
      },
      omit: { description: true },
      orderBy: [{ endAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
    });

    const horizon = new Date(
      now.getTime() + NEXT_OCCURRENCE_HORIZON_DAYS * DAY_MS,
    );
    const items: AgendaTaskView[] = [];
    for (const row of rows) {
      let occurrence: Occurrence | null = {
        start: row.startAt,
        end: row.endAt,
      };
      if (row.recurrenceFreq) {
        // Una serie de día completo "empieza" a las 00:00 UTC de su día: hoy ya
        // ha empezado, pero sigue siendo trabajo de hoy.
        const anchor = row.allDay ? calendarDayRange(now, now, tz).from : now;
        occurrence = firstStartingFrom(seriesSpecOf(row), anchor, horizon);
      }
      if (!occurrence) continue;
      const view = this.toView(row, this.resolve(row, occurrence), now);
      if (this.matchesEffective(view, filters)) items.push(view);
    }
    // Si la consulta llenó el tope, puede haber más trabajo abierto del que se muestra.
    return { items, truncated: rows.length === limit };
  }

  /** Series que ya terminaron (`until` pasado) no son trabajo abierto aunque su estado lo sea. */
  private notFinishedSeries(now: Date): Prisma.AgendaTaskWhereInput {
    return {
      OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: now } }],
    };
  }

  /** Mismo criterio que la lista de urgentes, para que el KPI y la lista coincidan. */
  private countUrgent(
    user: AuthenticatedUser,
    base: Prisma.AgendaTaskWhereInput[],
    now: Date,
  ): Promise<number> {
    return this.prisma.agendaTask.count({
      where: {
        AND: [
          this.scopeWhere(user),
          ...base,
          OPEN_WHERE,
          this.notFinishedSeries(now),
          { priority: 'URGENTE' },
        ],
      },
    });
  }

  /**
   * Tareas abiertas ya vencidas. Las series quedan fuera: sus ocurrencias
   * pasadas sin cerrar no son "deuda" que deba acumularse indefinidamente.
   *
   * Una tarea de día completo vence a la medianoche LOCAL de su zona, que no se
   * puede expresar en una condición de BD sin la zona de cada fila: se cuentan
   * en BD las que lo están seguro y se resuelven en memoria las pocas que caen
   * en la banda ambigua (±un día).
   */
  private async countOverdue(
    user: AuthenticatedUser,
    base: Prisma.AgendaTaskWhereInput[],
    now: Date,
  ): Promise<number> {
    const scope: Prisma.AgendaTaskWhereInput[] = [
      this.scopeWhere(user),
      ...base,
      OPEN_WHERE,
      { recurrenceFreq: null },
    ];
    const [sure, ambiguous] = await Promise.all([
      this.prisma.agendaTask.count({
        where: {
          AND: [
            ...scope,
            {
              OR: [
                timedOverdue(now),
                {
                  allDay: true,
                  endAt: {
                    lt: new Date(now.getTime() - ALL_DAY_DEADLINE_LATEST_MS),
                  },
                },
              ],
            },
          ],
        },
      }),
      this.prisma.agendaTask.findMany({
        where: {
          AND: [
            ...scope,
            {
              allDay: true,
              endAt: {
                gte: new Date(now.getTime() - ALL_DAY_DEADLINE_LATEST_MS),
                lt: new Date(now.getTime() + ALL_DAY_DEADLINE_EARLIEST_MS),
              },
            },
          ],
        },
        select: { endAt: true, timezone: true },
        take: MAX_RANGE_ITEMS,
      }),
    ]);
    const lateAllDay = ambiguous.filter(
      (row) =>
        localMidnightOf(row.endAt, row.timezone).getTime() < now.getTime(),
    ).length;
    return sure + lateAllDay;
  }

  // ── Filtros ─────────────────────────────────────────────────────────────

  private parseFilters(query: ListAgendaTasksQueryDto): Filters {
    return {
      estateId: query.estateId,
      assignee: query.assignee,
      status: parseCsv(query.status, Object.values(AgendaTaskStatus), 'status'),
      priority: parseCsv(
        query.priority,
        Object.values(AgendaTaskPriority),
        'priority',
      ),
      type: parseCsv(query.type, Object.values(AgendaTaskType), 'type'),
      labelIds: this.parseLabelIds(query.labelIds),
      q: query.q?.trim() || undefined,
      overdue: query.overdue === 'true',
    };
  }

  private parseLabelIds(raw: string | undefined): string[] | undefined {
    const ids = raw
      ?.split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!ids?.length) return undefined;
    if (ids.some((id) => !isUUID(id))) {
      throw new BadRequestException('Etiqueta inválida en "labelIds".');
    }
    return ids;
  }

  /** Condiciones de BD de los filtros (las que dependen de la ocurrencia se rematan en memoria). */
  private async filtersWhere(
    user: AuthenticatedUser,
    f: Filters,
  ): Promise<Prisma.AgendaTaskWhereInput[]> {
    const and: Prisma.AgendaTaskWhereInput[] = [];

    if (f.estateId) {
      if (!isUUID(f.estateId))
        throw new BadRequestException('Comunidad inválida.');
      this.estateAccess.assertAccess(f.estateId, user);
      and.push({ estateId: f.estateId });
    }
    if (f.assignee === 'me') and.push({ assignedToUserId: user.id });
    else if (f.assignee === 'none') and.push({ assignedToUserId: null });
    else if (f.assignee) {
      if (!isUUID(f.assignee))
        throw new BadRequestException('Responsable inválido.');
      and.push({ assignedToUserId: f.assignee });
    }
    if (f.priority) and.push({ priority: { in: f.priority } });
    if (f.type) and.push({ type: { in: f.type } });
    if (f.status) {
      // En una serie el estado depende de la ocurrencia: se filtra en memoria.
      and.push({
        OR: [{ recurrenceFreq: { not: null } }, { status: { in: f.status } }],
      });
    }
    if (f.labelIds?.length) {
      and.push({ labels: { some: { labelId: { in: f.labelIds } } } });
    }
    if (f.q) and.push(await this.searchWhere(user, f.q));
    return and;
  }

  private async searchWhere(
    user: AuthenticatedUser,
    q: string,
  ): Promise<Prisma.AgendaTaskWhereInput> {
    const contains = { contains: q, mode: 'insensitive' as const };
    const suppliers = await this.prisma.supplier.findMany({
      where: { administratorId: this.adminId(user), name: contains },
      select: { id: true },
      take: 50,
    });
    const or: Prisma.AgendaTaskWhereInput[] = [
      { title: contains },
      { description: contains },
      { estate: { name: contains } },
      { assignedTo: { fullName: contains } },
      { labels: { some: { label: { name: contains } } } },
    ];
    if (suppliers.length > 0) {
      or.push({
        links: {
          some: {
            entityType: 'supplier',
            entityId: { in: suppliers.map((s) => s.id) },
          },
        },
      });
    }
    return { OR: or };
  }

  /** Filtros que dependen del estado efectivo de cada ocurrencia. */
  private matchesEffective(view: AgendaTaskView, f: Filters): boolean {
    if (f.status && !f.status.includes(view.status)) return false;
    if (f.overdue && !view.overdue) return false;
    return true;
  }

  // ── Alta ────────────────────────────────────────────────────────────────

  async create(
    dto: CreateAgendaTaskDto,
    user: AuthenticatedUser,
  ): Promise<AgendaTaskDetail> {
    const administratorId = this.adminId(user);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('El título es obligatorio.');

    const schedule = this.normalizeSchedule(
      parseDate(dto.startAt, 'startAt'),
      parseDate(dto.endAt, 'endAt'),
      dto.allDay ?? false,
    );
    const timezone = this.normalizeTimezone(dto.timezone);
    const recurrence = this.normalizeRecurrence(dto.recurrence, schedule.start);

    if (dto.estateId) this.estateAccess.assertAccess(dto.estateId, user);
    if (dto.assignedToUserId) {
      await this.assertAssignee(administratorId, dto.assignedToUserId);
    }
    const labelIds = await this.assertLabels(
      administratorId,
      dto.labelIds ?? [],
    );
    const linked = await this.links.resolveForUser(user, dto.links ?? []);
    this.assertLinksMatchEstate(dto.estateId ?? null, linked);

    const status = dto.status ?? 'PENDIENTE';
    const now = new Date();
    const created = await this.prisma.agendaTask.create({
      data: {
        administratorId,
        estateId: dto.estateId ?? linked[0]?.estateId ?? null,
        title,
        description: dto.description?.trim() || null,
        assignedToUserId: dto.assignedToUserId ?? null,
        createdByUserId: user.id,
        type: dto.type ?? 'OTRA',
        priority: dto.priority ?? 'MEDIA',
        status,
        startAt: schedule.start,
        endAt: schedule.end,
        dueAt: this.normalizeDueAt(dto.dueAt, recurrence),
        allDay: schedule.allDay,
        noDuration: dto.noDuration ?? false,
        timezone,
        reminderMinutesBefore: dto.reminderMinutesBefore ?? null,
        recurrenceFreq: recurrence?.freq ?? null,
        recurrenceInterval: recurrence?.interval ?? 1,
        recurrenceUntil: recurrence?.until ?? null,
        source: MANUAL_SOURCE,
        completedAt: status === 'COMPLETADA' ? now : null,
        cancelledAt: status === 'CANCELADA' ? now : null,
        labels: { create: labelIds.map((labelId) => ({ labelId })) },
        checklist: {
          create: (dto.checklist ?? []).map((text, position) => ({
            text: text.trim(),
            position,
          })),
        },
        links: {
          create: linked.map((l) => ({
            entityType: l.type,
            entityId: l.id,
            label: l.label.slice(0, 200),
          })),
        },
      },
      select: { id: true },
    });
    await this.audit.logAccess(
      user,
      'agenda_task',
      'create',
      created.id,
      title.slice(0, 200),
    );
    return this.getById(created.id, user);
  }

  async duplicate(
    id: string,
    user: AuthenticatedUser,
  ): Promise<AgendaTaskDetail> {
    const source = await this.findScoped(id, user);
    const checklist = await this.prisma.agendaTaskChecklistItem.findMany({
      where: { taskId: id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { text: true },
    });
    const created = await this.prisma.agendaTask.create({
      data: {
        administratorId: source.administratorId,
        estateId: source.estateId,
        title: `${source.title} (copia)`.slice(0, 200),
        description: source.description,
        assignedToUserId: source.assignedToUserId,
        createdByUserId: user.id,
        type: source.type,
        priority: source.priority,
        status: 'PENDIENTE',
        startAt: source.startAt,
        endAt: source.endAt,
        dueAt: source.dueAt,
        allDay: source.allDay,
        noDuration: source.noDuration,
        timezone: source.timezone,
        reminderMinutesBefore: source.reminderMinutesBefore,
        recurrenceFreq: source.recurrenceFreq,
        recurrenceInterval: source.recurrenceInterval,
        recurrenceUntil: source.recurrenceUntil,
        source: MANUAL_SOURCE,
        labels: {
          create: source.labels.map((l) => ({ labelId: l.labelId })),
        },
        checklist: {
          create: checklist.map((c, position) => ({ text: c.text, position })),
        },
        links: {
          create: source.links.map((l) => ({
            entityType: l.entityType,
            entityId: l.entityId,
            label: l.label,
          })),
        },
      },
      select: { id: true },
    });
    await this.audit.logAccess(
      user,
      'agenda_task',
      'duplicate',
      created.id,
      `de ${id}`,
    );
    return this.getById(created.id, user);
  }

  // ── Edición ─────────────────────────────────────────────────────────────

  async update(
    id: string,
    dto: UpdateAgendaTaskDto,
    user: AuthenticatedUser,
  ): Promise<AgendaTaskDetail> {
    const administratorId = this.adminId(user);
    const existing = await this.findScoped(id, user);
    const data: Prisma.AgendaTaskUncheckedUpdateInput = {};
    let rescheduled = false;
    let reassigned = false;

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('El título es obligatorio.');
      data.title = title;
    }
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.priority !== undefined) data.priority = dto.priority;

    let start = existing.startAt;
    if (
      dto.startAt !== undefined ||
      dto.endAt !== undefined ||
      dto.allDay !== undefined
    ) {
      const schedule = this.normalizeSchedule(
        dto.startAt ? parseDate(dto.startAt, 'startAt') : existing.startAt,
        dto.endAt ? parseDate(dto.endAt, 'endAt') : existing.endAt,
        dto.allDay ?? existing.allDay,
      );
      data.startAt = schedule.start;
      data.endAt = schedule.end;
      data.allDay = schedule.allDay;
      start = schedule.start;
      rescheduled =
        schedule.start.getTime() !== existing.startAt.getTime() ||
        schedule.end.getTime() !== existing.endAt.getTime();
    }
    if (dto.noDuration !== undefined) data.noDuration = dto.noDuration;
    if (dto.timezone !== undefined) {
      data.timezone = this.normalizeTimezone(dto.timezone);
    }
    if (dto.dueAt !== undefined) {
      data.dueAt = this.normalizeDueAt(
        dto.dueAt ?? undefined,
        dto.recurrence !== undefined ? dto.recurrence : existing.recurrenceFreq,
      );
    }

    if (dto.recurrence !== undefined) {
      const rule = this.normalizeRecurrence(dto.recurrence ?? undefined, start);
      data.recurrenceFreq = rule?.freq ?? null;
      data.recurrenceInterval = rule?.interval ?? 1;
      data.recurrenceUntil = rule?.until ?? null;
    } else if (existing.recurrenceUntil && start > existing.recurrenceUntil) {
      throw new BadRequestException(
        'La serie termina antes de la nueva fecha de inicio.',
      );
    }

    if (dto.reminderMinutesBefore !== undefined) {
      data.reminderMinutesBefore = dto.reminderMinutesBefore;
    }
    let estateId = existing.estateId;
    if (dto.estateId !== undefined) {
      if (dto.estateId) this.estateAccess.assertAccess(dto.estateId, user);
      estateId = dto.estateId;
      data.estateId = dto.estateId;
    }

    if (dto.assignedToUserId !== undefined) {
      if (dto.assignedToUserId) {
        await this.assertAssignee(administratorId, dto.assignedToUserId);
      }
      reassigned = dto.assignedToUserId !== existing.assignedToUserId;
      data.assignedToUserId = dto.assignedToUserId;
    }

    const labelIds =
      dto.labelIds !== undefined
        ? await this.assertLabels(administratorId, dto.labelIds)
        : null;

    let linked = null as Awaited<
      ReturnType<AgendaTaskLinksService['resolveForUser']>
    > | null;
    if (dto.links !== undefined) {
      // La incidencia de la que nace una tarea es su vínculo de origen: se puede añadir más, pero no quitar esa.
      const origin = existing.issueId;
      const requested =
        origin && !dto.links.some((l) => l.type === 'issue' && l.id === origin)
          ? [...dto.links, { type: 'issue' as const, id: origin }]
          : dto.links;
      linked = await this.links.resolveForUser(user, requested);
      this.assertLinksMatchEstate(estateId, linked);
      if (!estateId && linked[0]) data.estateId = linked[0].estateId;
    } else if (dto.estateId !== undefined && estateId) {
      // Cambió la comunidad pero no los vínculos: los ya guardados deben seguir
      // siendo de esa comunidad.
      const stored = await this.links.describeStored(
        user,
        existing.links.map((l) => ({ type: l.entityType, id: l.entityId })),
      );
      this.assertLinksMatchEstate(estateId, stored);
    }

    // Reprogramar o reconfigurar una serie NO reescribe el pasado: las ocurrencias ya completadas/canceladas conservan su inicio
    // original y su estado. Solo se les congela el fin con la forma que tenía la serie antes de este cambio.
    const frozen = existing.recurrenceFreq
      ? await this.freezeResolvedOccurrences(existing)
      : null;

    await this.prisma.$transaction(async (tx) => {
      for (const o of frozen ?? []) {
        await tx.agendaTaskOccurrence.update({
          where: {
            taskId_occurrenceStart: {
              taskId: id,
              occurrenceStart: o.occurrenceStart,
            },
          },
          data: { occurrenceEnd: o.occurrenceEnd },
        });
      }
      if (labelIds) {
        await tx.agendaTaskLabelLink.deleteMany({ where: { taskId: id } });
        await tx.agendaTaskLabelLink.createMany({
          data: labelIds.map((labelId) => ({ taskId: id, labelId })),
        });
      }
      if (linked) {
        await tx.agendaTaskLink.deleteMany({ where: { taskId: id } });
        await tx.agendaTaskLink.createMany({
          data: linked.map((l) => ({
            taskId: id,
            entityType: l.type,
            entityId: l.id,
            label: l.label.slice(0, 200),
          })),
        });
      }
      await tx.agendaTask.update({ where: { id }, data });
    });

    if (reassigned) {
      await this.audit.logAccess(
        user,
        'agenda_task',
        'reassign',
        id,
        `a ${dto.assignedToUserId ?? 'sin asignar'}`,
      );
    }
    if (rescheduled) {
      await this.audit.logAccess(
        user,
        'agenda_task',
        'reschedule',
        id,
        `${(data.startAt as Date).toISOString()} → ${(data.endAt as Date).toISOString()}`,
      );
    }
    if (!reassigned && !rescheduled) {
      await this.audit.logAccess(user, 'agenda_task', 'update', id);
    }
    return this.getById(id, user);
  }

  /**
   * Las resoluciones de la serie a las que aún les falta el fin, con el que tenían ANTES de editarla (su ocurrencia vieja, con
   * la duración y la zona de entonces). Se llama con la serie todavía sin tocar; `null` si no hay nada que congelar.
   */
  private async freezeResolvedOccurrences(
    existing: SeriesRow & { id: string },
  ): Promise<{ occurrenceStart: Date; occurrenceEnd: Date }[] | null> {
    const stored = await this.prisma.agendaTaskOccurrence.findMany({
      where: { taskId: existing.id, occurrenceEnd: null },
      select: { occurrenceStart: true },
    });
    if (stored.length === 0) return null;
    const spec = seriesSpecOf(existing);
    return stored.map((row) => {
      const index = occurrenceIndexOf(spec, row.occurrenceStart);
      return {
        occurrenceStart: row.occurrenceStart,
        occurrenceEnd:
          index === null
            ? new Date(
                row.occurrenceStart.getTime() +
                  (existing.endAt.getTime() - existing.startAt.getTime()),
              )
            : occurrenceAt(spec, index).end,
      };
    });
  }

  /** Fin de la ocurrencia que empieza en `start` según la serie actual (se congela al resolverla). */
  private occurrenceEndOf(series: SeriesRow, start: Date): Date {
    const spec = seriesSpecOf(series);
    const index = occurrenceIndexOf(spec, start);
    return index === null
      ? new Date(
          start.getTime() + (series.endAt.getTime() - series.startAt.getTime()),
        )
      : occurrenceAt(spec, index).end;
  }

  async updateStatus(
    id: string,
    dto: UpdateTaskStatusDto,
    user: AuthenticatedUser,
  ): Promise<AgendaTaskDetail> {
    const task = await this.findScoped(id, user);
    const now = new Date();
    if (task.kind && isTerminal(dto.status)) {
      // Completarla a secas la cerraría sin ejecutar la decisión (aprobar, confirmar…).
      throw new BadRequestException(
        'Esta tarea es una decisión: se resuelve con su acción, no se marca como hecha.',
      );
    }
    if (task.kind && isTerminal(task.status)) {
      // Reabrirla dejaría pendiente una decisión que ya se ejecutó.
      throw new BadRequestException('Esta decisión ya está resuelta.');
    }
    if (dto.restorePrevious && dto.status !== 'PENDIENTE') {
      throw new BadRequestException(
        'restorePrevious solo se admite junto con el estado PENDIENTE.',
      );
    }
    if (dto.status === 'COMPLETADA') {
      const open = await this.prisma.agendaTaskChecklistItem.count({
        where: { taskId: id, done: false },
      });
      if (open > 0) {
        throw new BadRequestException(
          open === 1
            ? 'No se puede completar la tarea: queda 1 subtarea de la checklist sin completar.'
            : `No se puede completar la tarea: quedan ${open} subtareas de la checklist sin completar.`,
        );
      }
    }

    if (dto.occurrenceStart) {
      if (!task.recurrenceFreq) {
        throw new BadRequestException('Esta tarea no se repite.');
      }
      const start = parseDate(dto.occurrenceStart, 'occurrenceStart');
      if (!isOccurrenceStart(seriesSpecOf(task), start)) {
        throw new BadRequestException(
          'La ocurrencia indicada no existe en la serie.',
        );
      }
      if (dto.status === 'COMPLETADA' || dto.status === 'CANCELADA') {
        await this.prisma.agendaTaskOccurrence.upsert({
          where: {
            taskId_occurrenceStart: { taskId: id, occurrenceStart: start },
          },
          create: {
            taskId: id,
            occurrenceStart: start,
            occurrenceEnd: this.occurrenceEndOf(task, start),
            status: dto.status,
          },
          update: { status: dto.status, resolvedAt: now },
        });
      } else if (dto.status === 'PENDIENTE') {
        await this.prisma.agendaTaskOccurrence.deleteMany({
          where: { taskId: id, occurrenceStart: start },
        });
      } else {
        throw new BadRequestException(
          'Una ocurrencia solo puede completarse, cancelarse o reabrirse.',
        );
      }
    } else {
      // Desmarcar una tarea completada devuelve el estado que tenía antes.
      const status =
        dto.restorePrevious && task.status === 'COMPLETADA'
          ? (task.statusBeforeCompletion ?? 'PENDIENTE')
          : dto.status;
      await this.prisma.agendaTask.update({
        where: { id },
        data: {
          status,
          completedAt: status === 'COMPLETADA' ? now : null,
          cancelledAt: status === 'CANCELADA' ? now : null,
          // Se recuerda el estado de origen al completar; completar otra vez no lo pisa.
          statusBeforeCompletion:
            status === 'COMPLETADA'
              ? task.status === 'COMPLETADA'
                ? task.statusBeforeCompletion
                : task.status
              : null,
        },
      });
    }

    await this.traceIssueTask(task, dto.status, user);
    const action =
      dto.status === 'COMPLETADA'
        ? 'complete'
        : dto.status === 'CANCELADA'
          ? 'cancel'
          : 'status';
    await this.audit.logAccess(
      user,
      'agenda_task',
      action,
      id,
      (dto.occurrenceStart
        ? `${dto.status} @ ${dto.occurrenceStart}`
        : dto.status
      ).slice(0, 255),
    );
    return this.getById(id, user);
  }

  /** Una tarea de una incidencia que se completa, cancela o reabre deja su rastro en el historial de la incidencia. */
  private async traceIssueTask(
    task: {
      id: string;
      title: string;
      issueId: string | null;
      kind: string | null;
    },
    status: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    // Una decisión (con `kind`) ya deja su rastro al resolverse por su acción.
    if (!task.issueId || task.kind) return;
    const [kind, text] =
      status === 'COMPLETADA'
        ? (['task_resolved', `Tarea completada: ${task.title}`] as const)
        : status === 'CANCELADA'
          ? (['task_cancelled', `Tarea cancelada: ${task.title}`] as const)
          : status === 'PENDIENTE'
            ? (['task_reopened', `Tarea reabierta: ${task.title}`] as const)
            : ([null, null] as const);
    if (!kind || !text) return;
    await this.prisma.issueTimelineEntry.create({
      data: {
        issueId: task.issueId,
        ...issueEventData({
          kind,
          actorKind: 'person',
          authorUserId: user.id,
          text,
          refType: 'agenda_task',
          refId: task.id,
        }),
      },
    });
  }

  async remove(id: string, user: AuthenticatedUser): Promise<void> {
    const task = await this.findScoped(id, user);
    if (task.kind && !isTerminal(task.status)) {
      throw new BadRequestException(
        'Esta tarea es una decisión pendiente: resuélvela con su acción antes de borrarla.',
      );
    }
    const files = await this.prisma.agendaTaskAttachment.findMany({
      where: { taskId: id },
      select: { s3Key: true },
    });
    await this.prisma.agendaTask.delete({ where: { id } });
    await this.audit.logAccess(
      user,
      'agenda_task',
      'delete',
      id,
      task.title.slice(0, 200),
    );
    // Tras borrar la fila: un fallo de disco no debe dejar la tarea a medias.
    for (const file of files) {
      await this.storage.delete(file.s3Key).catch((error: unknown) => {
        this.logger.warn(
          `No se pudo borrar el fichero ${file.s3Key}: ${String(error)}`,
        );
      });
    }
  }

  // ── Equipo y etiquetas ──────────────────────────────────────────────────

  /** Responsables posibles: los usuarios de la propia gestora. */
  async listAssignees(user: AuthenticatedUser): Promise<PersonRef[]> {
    return this.prisma.user.findMany({
      where: {
        administratorId: this.adminId(user),
        role: 'B',
        deletedAt: null,
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  /**
   * Siembra las etiquetas iniciales UNA sola vez por gestora. La marca
   * `agenda_labels_initialized_at` distingue "catálogo nunca inicializado" de
   * "inicializado y después modificado o vaciado": lo segundo no vuelve a
   * sembrarse, por mucho que la gestora haya borrado etiquetas (o todas).
   *
   * El UPDATE condicionado actúa de cerrojo: con peticiones simultáneas solo una
   * consigue la marca y siembra, y las demás esperan a que termine su
   * transacción antes de leer.
   */
  private async ensureLabelCatalog(administratorId: string): Promise<void> {
    const admin = await this.prisma.administrator.findUnique({
      where: { id: administratorId },
      select: { agendaLabelsInitializedAt: true },
    });
    if (!admin || admin.agendaLabelsInitializedAt) return;
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.administrator.updateMany({
        where: { id: administratorId, agendaLabelsInitializedAt: null },
        data: { agendaLabelsInitializedAt: new Date() },
      });
      if (claimed.count === 0) return;
      await tx.agendaTaskLabel.createMany({
        data: DEFAULT_LABELS.map((name) => ({ administratorId, name })),
        skipDuplicates: true,
      });
    });
  }

  async listLabels(user: AuthenticatedUser) {
    const administratorId = this.adminId(user);
    await this.ensureLabelCatalog(administratorId);
    return this.prisma.agendaTaskLabel.findMany({
      where: { administratorId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async createLabel(name: string, user: AuthenticatedUser) {
    const administratorId = this.adminId(user);
    const clean = name.trim().replace(/\s+/g, ' ');
    if (!clean)
      throw new BadRequestException('El nombre de la etiqueta es obligatorio.');
    // Si la gestora estrena Tareas creando una etiqueta, el catálogo inicial se
    // siembra antes: así "ya inicializado" significa lo mismo en todos los caminos.
    await this.ensureLabelCatalog(administratorId);
    const duplicate = await this.prisma.agendaTaskLabel.findFirst({
      where: { administratorId, name: { equals: clean, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (duplicate) return duplicate;
    return this.prisma.agendaTaskLabel.create({
      data: { administratorId, name: clean },
      select: { id: true, name: true },
    });
  }

  async deleteLabel(id: string, user: AuthenticatedUser): Promise<void> {
    const result = await this.prisma.agendaTaskLabel.deleteMany({
      where: {
        id: isUUID(id) ? id : undefined,
        administratorId: this.adminId(user),
      },
    });
    if (result.count === 0)
      throw new NotFoundException('Etiqueta no encontrada.');
  }

  // ── Validaciones ────────────────────────────────────────────────────────

  private assertAssignee(administratorId: string, userId: string) {
    return assertTeamAssignee(this.prisma, administratorId, userId);
  }

  private async assertLabels(
    administratorId: string,
    ids: string[],
  ): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return unique;
    const count = await this.prisma.agendaTaskLabel.count({
      where: { id: { in: unique }, administratorId },
    });
    if (count !== unique.length) {
      throw new BadRequestException('Alguna etiqueta no existe.');
    }
    return unique;
  }

  private assertLinksMatchEstate(
    estateId: string | null,
    linked: { estateId: string }[],
  ): void {
    if (estateId && linked.some((l) => l.estateId !== estateId)) {
      throw new BadRequestException(
        'Las entidades vinculadas deben ser de la misma comunidad que la tarea.',
      );
    }
  }

  /** El plazo propio de una tarea: una fecha, y nunca en una serie (cada ocurrencia vence con su bloque). */
  private normalizeDueAt(
    dueAt: string | undefined,
    recurrence: unknown,
  ): Date | null {
    if (dueAt === undefined) return null;
    if (recurrence)
      throw new BadRequestException(
        'Una tarea que se repite no tiene un plazo propio: cada ocurrencia vence al terminar.',
      );
    return parseDate(dueAt, 'dueAt');
  }

  private normalizeTimezone(timezone: string | undefined): string {
    const zone = timezone?.trim() || DEFAULT_TIMEZONE;
    if (!isValidTimezone(zone)) {
      throw new BadRequestException('Zona horaria inválida.');
    }
    return zone;
  }

  private normalizeSchedule(
    startAt: Date,
    endAt: Date,
    allDay: boolean,
  ): { start: Date; end: Date; allDay: boolean } {
    let start = startAt;
    let end = endAt;
    if (allDay) {
      // Día completo: fecha de calendario (medianoches UTC, fin exclusivo).
      start = utcMidnight(startAt);
      end = utcMidnight(endAt);
      if (end.getTime() <= start.getTime())
        end = new Date(start.getTime() + DAY_MS);
    } else if (end.getTime() < start.getTime()) {
      throw new BadRequestException(
        'La hora de fin es anterior a la de inicio.',
      );
    }
    if ((end.getTime() - start.getTime()) / DAY_MS > MAX_TASK_DURATION_DAYS) {
      throw new BadRequestException(
        `Una tarea no puede durar más de ${MAX_TASK_DURATION_DAYS} días.`,
      );
    }
    return { start, end, allDay };
  }

  private normalizeRecurrence(
    rule: RecurrenceDto | undefined,
    start: Date,
  ): {
    freq: RecurrenceDto['freq'];
    interval: number;
    until: Date | null;
  } | null {
    if (!rule) return null;
    const until = rule.until ? parseDate(rule.until, 'recurrence.until') : null;
    if (until && until.getTime() < start.getTime()) {
      throw new BadRequestException('La repetición termina antes de empezar.');
    }
    return { freq: rule.freq, interval: rule.interval, until };
  }

  // ── Mapeo ───────────────────────────────────────────────────────────────

  private toView(
    row: ViewRow,
    expanded: ExpandedOccurrence,
    now: Date,
  ): AgendaTaskView {
    const { occurrence, status } = expanded;
    const recurring = row.recurrenceFreq !== null;
    return {
      id: row.id,
      occurrenceKey: recurring
        ? `${row.id}@${occurrence.start.toISOString()}`
        : row.id,
      recurring,
      occurrenceStart: occurrence.start.toISOString(),
      occurrenceEnd: occurrence.end.toISOString(),
      title: row.title,
      estate: row.estate,
      assignee: row.assignedTo,
      type: row.type,
      priority: row.priority,
      status,
      overdue: isOverdue(status, expanded.deadline, now),
      allDay: row.allDay,
      noDuration: row.noDuration,
      timezone: row.timezone,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      dueAt: !row.recurrenceFreq && row.dueAt ? row.dueAt.toISOString() : null,
      reminderMinutesBefore: row.reminderMinutesBefore,
      recurrence: row.recurrenceFreq
        ? {
            freq: row.recurrenceFreq,
            interval: row.recurrenceInterval,
            until: row.recurrenceUntil?.toISOString() ?? null,
          }
        : null,
      labels: row.labels.map((l) => l.label),
      checklistDone: row.checklist.filter((c) => c.done).length,
      checklistTotal: row.checklist.length,
      commentCount: row._count.comments,
      attachmentCount: row._count.attachments,
      linkCount: row._count.links,
      source: row.source,
      createdByUserId: row.createdByUserId,
      createdByKind: row.createdByKind,
      issueId: row.issueId,
      kind: row.kind,
    };
  }

  private async toDetail(
    row: DetailRow,
    user: AuthenticatedUser,
  ): Promise<AgendaTaskDetail> {
    const view = this.toView(
      row,
      this.resolve(row, { start: row.startAt, end: row.endAt }),
      new Date(),
    );
    const linkRefs: StoredLinkRef[] = row.links.map((l) => ({
      type: l.entityType,
      id: l.entityId,
      label: l.label,
    }));
    return {
      ...view,
      description: row.description,
      createdBy: row.createdBy,
      payload: row.payload,
      outcome: row.outcome,
      resultRef: row.resultRef,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      checklist: row.checklist.map((c) => ({
        id: c.id,
        text: c.text,
        done: c.done,
        position: c.position,
      })),
      comments: row.comments.map((c) => ({
        id: c.id,
        text: c.text,
        createdAt: c.createdAt.toISOString(),
        author: c.author,
      })),
      attachments: row.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        createdAt: a.createdAt.toISOString(),
      })),
      links: await this.links.describeForDisplay(user, linkRefs, row.estateId),
    };
  }
}
