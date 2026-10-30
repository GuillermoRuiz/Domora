import { issuesOfEstate } from '../issues/issue-estate';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { IssueStatus, Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { OPEN_STATUSES } from '../agenda-tasks/agenda-task.constants';
import { IssueWorkflowConfig } from './issue-workflow.config';
import {
  computeBallInCourt,
  type BallInCourt,
  type BallParty,
  ISSUE_SITUATIONS,
  ISSUE_SITUATION_FILTER_KEYS,
  inSituationFilter,
  type IssueSituationFilter,
  SITUATION_LABELS,
  attentionTasksOf,
  buildNextStep,
  computeSituation,
  isTerminalIssueStatus,
  taskActionLabel,
  toAttentionTask,
  type AttentionTask,
  type IssueFacts,
  type IssueSituation,
  type NextStep,
  type SituationOptions,
} from './issue-situation';

/** Tareas de decisión que se enseñan en el detalle: el resto está en el módulo Tareas. */
const ATTENTION_PREVIEW = 3;
// Keep every `IN` well below PostgreSQL's bind-parameter ceiling while avoiding
// hundreds of sequential round trips for large administrator-wide scopes.
const CHUNK = 5_000;

export interface IssueSituationView {
  issueId: string;
  situation: IssueSituation;
  label: string;
  nextStep: NextStep;
  /** Quién tiene ahora la pelota: una proyección (puede haber varios con esperas simultáneas). */
  ballInCourt: BallInCourt;
  /** Trabajo humano pendiente relacionado. Solo un aviso y un enlace: se gestiona en Tareas. */
  attention: { count: number; tasks: AttentionTask[] };
}

export interface IssueSituationSummary {
  /** Incidencias no borradas del ámbito. */
  total: number;
  /** Las que siguen abiertas (ni resueltas ni cerradas). */
  activeTotal: number;
  counts: Record<IssueSituation, number>;
  /** Los mismos recuentos agrupados como filtros de trabajo (`ISSUE_SITUATION_FILTERS`): lo que ve la lista. */
  filters: Record<IssueSituationFilter, number>;
  /** Cuántas de las incidencias activas necesitan una actuación de la gestión. */
  requiresAttention: number;
}

type IssueScopeWhere = Prisma.IssueWhereInput;

export interface ClassifiedIssue {
  id: string;
  situation: IssueSituation;
  /** Quién tiene la pelota ahora (el primero de los que la tienen). */
  ball: BallParty;
  /** Datos con los que la lista ordena por columna. */
  ref: string;
  title: string;
  estateName: string;
  status: IssueStatus;
  /** Datos ya leídos por `classify`; las filas visibles los reutilizan sin volver a consultar sus fuentes. */
  facts: IssueFacts;
  estateId: string;
  type: string;
  priority: 'Normal' | 'Urgente';
  evaluatedAt: Date;
  options: SituationOptions;
}

/**
 * Proyección de la situación de las incidencias a partir de sus fuentes de
 * verdad (tareas, esperas, visitas). No guarda nada: así no puede
 * contradecirse con ellas.
 */
@Injectable()
export class IssueSituationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly flow: IssueWorkflowConfig = new IssueWorkflowConfig(),
  ) {}

  /** Márgenes de la proyección manual. */
  private async options(_now: Date): Promise<SituationOptions> {
    return {
      stalledGraceMs: this.flow.stalledGraceMs,
      visitGraceMs: this.flow.visitGraceMs,
    };
  }

  /** La situación de unos hechos ya cargados. */
  async situationOf(facts: IssueFacts, now: Date = new Date()): Promise<IssueSituation> {
    return computeSituation(facts, now, await this.options(now));
  }

  private assertManager(user: AuthenticatedUser): void {
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo la gestión ve la situación operativa.',
      );
    }
  }

  /** Lo que la proyección necesita, en cinco consultas para cualquier número de incidencias. */
  async loadFacts(
    issueIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, IssueFacts>> {
    const facts = new Map<string, IssueFacts>();
    if (issueIds.length === 0) return facts;
    const [issues, tasks, waits, visits, activity, infoRequests] =
      await Promise.all([
        this.prisma.issue.findMany({
          where: { id: { in: issueIds }, deletedAt: null },
          select: { id: true, status: true },
        }),
        this.prisma.agendaTask.findMany({
          where: {
            issueId: { in: issueIds },
            status: { in: OPEN_STATUSES },
          },
          select: {
            id: true,
            issueId: true,
            title: true,
            description: true,
            kind: true,
            priority: true,
            status: true,
            endAt: true,
            createdAt: true,
          },
        }),
        this.prisma.issueWait.findMany({
          where: { issueId: { in: issueIds }, endedAt: null },
          select: {
            id: true,
            issueId: true,
            kind: true,
            party: true,
            partyLabel: true,
            startedAt: true,
            dueAt: true,
          },
        }),
        this.prisma.supplierVisit.findMany({
          where: { issueId: { in: issueIds }, status: 'planificada' },
          select: {
            id: true,
            issueId: true,
            scheduledAt: true,
            visitorLabel: true,
            supplier: { select: { name: true } },
            // Visita de un profesional externo: el nombre sale de su asignación.
            assignment: { select: { providerNameSnapshot: true } },
          },
        }),
        this.prisma.issueTimelineEntry.groupBy({
          by: ['issueId'],
          where: { issueId: { in: issueIds } },
          _max: { date: true },
        }),
        // Desde cuándo se espera la información de quien avisó (solo importa en `PendienteInformacion`).
        this.prisma.issueTimelineEntry.groupBy({
          by: ['issueId'],
          where: { issueId: { in: issueIds }, kind: 'info_requested' },
          _max: { date: true },
        }),
      ]);
    const lastActivity = new Map(activity.map((a) => [a.issueId, a._max.date]));
    const infoRequestedAt = new Map(
      infoRequests.map((a) => [a.issueId, a._max.date]),
    );

    for (const issue of issues) {
      facts.set(issue.id, {
        issueId: issue.id,
        status: issue.status,
        tasks: [],
        waits: [],
        visits: [],
        lastActivityAt: lastActivity.get(issue.id) ?? null,
        infoRequestedAt: infoRequestedAt.get(issue.id) ?? null,
      });
    }
    for (const t of tasks) {
      facts
        .get(t.issueId as string)
        ?.tasks.push({ ...t, title: taskActionLabel(t) });
    }
    for (const w of waits) facts.get(w.issueId)?.waits.push(w);
    for (const v of visits) {
      facts.get(v.issueId as string)?.visits.push({
        id: v.id,
        scheduledAt: v.scheduledAt,
        supplierName:
          v.supplier?.name ??
          v.assignment?.providerNameSnapshot ??
          v.visitorLabel ??
          'el profesional',
      });
    }
    return facts;
  }

  private view(
    facts: IssueFacts,
    now: Date,
    options: SituationOptions,
  ): IssueSituationView {
    // Una incidencia terminada no necesita atención de nadie.
    const attention = isTerminalIssueStatus(facts.status)
      ? []
      : attentionTasksOf(facts);
    const situation = computeSituation(facts, now, options);
    return {
      issueId: facts.issueId,
      situation,
      label: SITUATION_LABELS[situation],
      nextStep: buildNextStep(facts, now, options),
      ballInCourt: computeBallInCourt(facts, now, options),
      attention: {
        count: attention.length,
        tasks: attention
          .slice(0, ATTENTION_PREVIEW)
          .map((t) => toAttentionTask(t, now)),
      },
    };
  }

  async forIssue(
    issueId: string,
    user: AuthenticatedUser,
  ): Promise<IssueSituationView> {
    this.assertManager(user);
    const issue = await this.prisma.issue.findFirst({
      where: { id: issueId, deletedAt: null },
      select: {
        type: true,
        priority: true,
        estateId: true,
      },
    });
    if (!issue)
      throw new NotFoundException(`Incidencia ${issueId} no encontrada.`);
    const estateId = issue.estateId;
    this.estateAccess.assertAccess(estateId, user);
    const now = new Date();
    const facts = (await this.loadFacts([issueId], now)).get(issueId);
    if (!facts)
      throw new NotFoundException(`Incidencia ${issueId} no encontrada.`);
    return this.view(
      facts,
      now,
      await this.options(now),
    );
  }

  /** Situación de varias incidencias de UNA finca (la lista de Incidencias pide las de su página). */
  async forIssues(
    estateId: string,
    issueIds: string[],
    user: AuthenticatedUser,
  ): Promise<Record<string, IssueSituationView>> {
    this.assertManager(user);
    this.estateAccess.assertAccess(estateId, user);
    const scoped = await this.prisma.issue.findMany({
      where: {
        id: { in: issueIds },
        deletedAt: null,
        ...issuesOfEstate(estateId),
      },
      select: { id: true, type: true, priority: true },
    });
    const views = await this.viewsFor(
      scoped.map((i) => ({ ...i, estateId })),
      new Date(),
    );
    return Object.fromEntries(views);
  }

  /** Situación, siguiente paso y pelota de las incidencias dadas (de una o de varias fincas). */
  async viewsFor(
    issues: {
      id: string;
      estateId: string;
      type: string;
      priority: 'Normal' | 'Urgente';
    }[],
    now: Date = new Date(),
  ): Promise<Map<string, IssueSituationView>> {
    const result = new Map<string, IssueSituationView>();
    if (issues.length === 0) return result;
    const facts = await this.loadFacts(
      issues.map((i) => i.id),
      now,
    );
    const options = await this.options(now);
    for (const issue of issues) {
      const f = facts.get(issue.id);
      if (f) result.set(issue.id, this.view(f, now, options));
    }
    return result;
  }

  /**
   * Construye la vista rica de una página ya clasificada. Los hechos y las
   * opciones son exactamente los usados al clasificar, por lo que no hay una
   * segunda lectura ni una ventana temporal en la que cambie la situación.
   */
  async viewsFromClassified(
    issues: ClassifiedIssue[],
    _context?: { administratorId?: string },
  ): Promise<Map<string, IssueSituationView>> {
    const result = new Map<string, IssueSituationView>();
    for (const issue of issues)
      result.set(
        issue.id,
        this.view(issue.facts, issue.evaluatedAt, issue.options),
      );
    return result;
  }

  /**
   * Situación y quién tiene la pelota de TODAS las incidencias que cumplen `where`, en el orden del listado. Es la
   * misma proyección que el detalle y el resumen; la lista del espacio de trabajo filtra y pagina sobre este resultado.
   */
  async classify(
    where: Prisma.IssueWhereInput,
    sort: 'newest' | 'oldest' = 'newest',
    now: Date = new Date(),
  ): Promise<ClassifiedIssue[]> {
    const options = await this.options(now);
    const issues = await this.prisma.issue.findMany({
      where,
      select: {
        id: true,
        ref: true,
        title: true,
        status: true,
        estateId: true,
        type: true,
        priority: true,
        estate: { select: { name: true } },
      },
      orderBy: [{ date: sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }],
    });
    const byId = new Map(issues.map((issue) => [issue.id, issue]));
    const result: ClassifiedIssue[] = [];
    for (let i = 0; i < issues.length; i += CHUNK) {
      const ids = issues.slice(i, i + CHUNK).map((x) => x.id);
      const facts = await this.loadFacts(ids, now);
      for (const id of ids) {
        const f = facts.get(id);
        if (f)
          result.push({
            id,
            situation: computeSituation(f, now, options),
            ball: computeBallInCourt(f, now, options).primary,
            ref: byId.get(id)?.ref ?? '',
            title: byId.get(id)?.title ?? '',
            estateName: byId.get(id)?.estate.name ?? '',
            status: f.status,
            facts: f,
            estateId: byId.get(id)?.estateId ?? '',
            type: byId.get(id)?.type ?? '',
            priority: byId.get(id)?.priority ?? 'Normal',
            evaluatedAt: now,
            options,
          });
      }
    }
    return result;
  }

  /**
   * Recuento por situación de las incidencias de una finca (`estateId`) o de
   * todas las que ve el usuario. Reutiliza la MISMA proyección que el detalle:
   * dos cálculos distintos acabarían divergiendo.
   */
  async summary(
    user: AuthenticatedUser,
    estateId?: string,
  ): Promise<IssueSituationSummary> {
    this.assertManager(user);
    if (estateId) this.estateAccess.assertAccess(estateId, user);
    const scope: IssueScopeWhere = {
      deletedAt: null,
      ...(estateId
        ? issuesOfEstate(estateId)
        : user.role === 'A'
          ? {}
          : issuesOfEstate(user.estateIds)),
    };
    const issues = await this.prisma.issue.findMany({
      where: scope,
      select: { id: true },
    });
    const counts = Object.fromEntries(
      ISSUE_SITUATIONS.map((s) => [s, 0]),
    ) as Record<IssueSituation, number>;
    const now = new Date();
    const options = await this.options(now);
    let activeTotal = 0;
    const filters = Object.fromEntries(
      ISSUE_SITUATION_FILTER_KEYS.map((key) => [key, 0]),
    ) as Record<IssueSituationFilter, number>;
    for (let i = 0; i < issues.length; i += CHUNK) {
      const ids = issues.slice(i, i + CHUNK).map((x) => x.id);
      const facts = await this.loadFacts(ids, now);
      for (const f of facts.values()) {
        const situation = computeSituation(f, now, options);
        counts[situation] += 1;
        for (const key of ISSUE_SITUATION_FILTER_KEYS)
          if (inSituationFilter(key, situation, f.status)) filters[key] += 1;
        if (ACTIVE_ISSUE_STATUSES.includes(f.status)) activeTotal += 1;
      }
    }
    return {
      total: issues.length,
      activeTotal,
      counts,
      filters,
      requiresAttention: counts.requires_attention,
    };
  }

  /**
   * Ids de las incidencias de UNA finca cuya situación cae en un filtro de trabajo, en el orden del listado (más
   * recientes primero). Usa la misma proyección que el detalle y el resumen: la situación no se guarda, así que se
   * calcula para las incidencias de la finca y el listado pagina sobre el resultado.
   */
  async issueIdsInFilter(
    estateId: string,
    filter: IssueSituationFilter,
    now: Date = new Date(),
  ): Promise<string[]> {
    const options = await this.options(now);
    const issues = await this.prisma.issue.findMany({
      where: { deletedAt: null, ...issuesOfEstate(estateId) },
      select: { id: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
    });
    const matching: string[] = [];
    for (let i = 0; i < issues.length; i += CHUNK) {
      const ids = issues.slice(i, i + CHUNK).map((x) => x.id);
      const facts = await this.loadFacts(ids, now);
      for (const id of ids) {
        const f = facts.get(id);
        if (f && inSituationFilter(filter, computeSituation(f, now, options), f.status))
          matching.push(id);
      }
    }
    return matching;
  }
}
