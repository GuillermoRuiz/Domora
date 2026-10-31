import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { resolvePage, toPage } from '../common/pagination';
import type { IssuesQueryDto, MeetingsQueryDto } from './operations-query.dto';
import {
  IssueSituationService,
  type ClassifiedIssue,
  type IssueSituationView,
} from '../issue-workflow/issue-situation.service';
import { BALL_PARTIES } from '../issue-workflow/issue-situation';
import {
  ISSUE_SITUATION_FILTER_KEYS,
  inSituationFilter,
} from '../issue-workflow/issue-situation';

const ESTATE_SELECT = {
  id: true,
  name: true,
  address: true,
  streetNumber: true,
  location: true,
} as const;

const ISSUE_ESTATE_SELECT = { id: true, name: true } as const;

const ISSUE_LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  date: true,
  description: true,
  ref: true,
  estate: { select: ISSUE_ESTATE_SELECT },
} as const satisfies Prisma.IssueSelect;

type IssueListRecord = Prisma.IssueGetPayload<{
  select: typeof ISSUE_LIST_SELECT;
}>;
export type IssueListItemDto = Omit<IssueListRecord, 'description'> & {
  /** La lista solo pinta la primera línea; el texto completo pertenece al detalle. */
  description: string;
  situationView: IssueSituationView | null;
};

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly situation: IssueSituationService,
  ) {}

  private scope(user: AuthenticatedUser, estateId?: string) {
    if (
      user.role !== 'B' ||
      !user.administratorId ||
      (estateId && !user.estateIds.includes(estateId))
    ) {
      throw new ForbiddenException(
        'No tienes acceso a este ámbito de comunidades.',
      );
    }
    return {
      estateId: estateId ?? { in: user.estateIds },
      estate: { administratorId: user.administratorId, deletedAt: null },
    };
  }

  async meetings(user: AuthenticatedUser, query: MeetingsQueryDto) {
    const scope = this.scope(user, query.estateId);
    const search = query.search?.trim();
    const base: Prisma.MeetingWhereInput = {
      ...scope,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { estate: { name: { contains: search, mode: 'insensitive' } } },
              {
                estate: { address: { contains: search, mode: 'insensitive' } },
              },
            ],
          }
        : {}),
    };
    const pendingActa = { status: 'celebrada' as const, actaSignedAt: null };
    const where: Prisma.MeetingWhereInput = {
      ...base,
      ...(query.filter === 'acta'
        ? pendingActa
        : query.filter && query.filter !== 'all'
          ? { status: query.filter }
          : {}),
    };
    const page = resolvePage({
      page: query.page,
      pageSize: Math.min(query.pageSize ?? 12, 100),
    });
    const [total, items, convocada, celebrada, firmada, cancelada, acta] =
      await Promise.all([
        this.prisma.meeting.count({ where }),
        this.prisma.meeting.findMany({
          where,
          select: {
            id: true,
            estateId: true,
            title: true,
            type: true,
            status: true,
            scheduledAt1: true,
            scheduledAt2: true,
            agenda: true,
            location: true,
            includeJitsi: true,
            actaSignedAt: true,
            celebratedAt: true,
            estate: { select: ESTATE_SELECT },
          },
          orderBy: [
            { scheduledAt1: query.sort === 'oldest' ? 'asc' : 'desc' },
            { id: 'asc' },
          ],
          skip: page.skip,
          take: page.take,
        }),
        this.prisma.meeting.count({ where: { ...base, status: 'convocada' } }),
        this.prisma.meeting.count({ where: { ...base, status: 'celebrada' } }),
        this.prisma.meeting.count({ where: { ...base, status: 'firmada' } }),
        this.prisma.meeting.count({ where: { ...base, status: 'cancelada' } }),
        this.prisma.meeting.count({ where: { ...base, ...pendingActa } }),
      ]);
    return {
      ...toPage(total, page, items),
      summary: { convocada, celebrada, firmada, cancelada, acta },
    };
  }

  async issues(user: AuthenticatedUser, query: IssuesQueryDto) {
    const scope = this.scope(user, query.estateId);
    const search = query.search?.trim();
    // La instalación acota el ámbito entero (también los contadores de las tarjetas), igual que la comunidad.
    const scoped: Prisma.IssueWhereInput = {
      deletedAt: null,
      ...scope,
      ...(query.assetId ? { assetId: query.assetId } : {}),
    };
    const created = createdSince(query.created);
    const matching: Prisma.IssueWhereInput = {
      ...scoped,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { ref: { contains: search, mode: 'insensitive' } },
              { estate: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(created ? { date: { gte: created } } : {}),
    };
    const page = resolvePage({
      page: query.page,
      pageSize: Math.min(query.pageSize ?? 12, 100),
    });
    // La situación y quién tiene la pelota no se guardan: se proyectan (misma proyección que el detalle) para todas
    // las incidencias del ámbito y la lista se filtra y pagina sobre ese resultado.
    const [classified, matches] = await Promise.all([
      this.situation.classify(
        scoped,
        query.sort === 'oldest' ? 'oldest' : 'newest',
      ),
      this.prisma.issue.findMany({ where: matching, select: { id: true } }),
    ]);
    const counts = {
      all: classified.length,
      ...Object.fromEntries(
        ISSUE_SITUATION_FILTER_KEYS.map((key) => [
          key,
          classified.filter((c) =>
            inSituationFilter(key, c.situation, c.status),
          ).length,
        ]),
      ),
    };
    const matched = new Set(matches.map((m) => m.id));
    const group = query.filter && query.filter !== 'all' ? query.filter : null;
    const rows = sortClassified(classified, query.sort).filter(
      (c) =>
        matched.has(c.id) &&
        (!group || inSituationFilter(group, c.situation, c.status)) &&
        (!query.situation || c.situation === query.situation) &&
        (!query.ball || c.ball === query.ball),
    );
    const pageRows = rows.slice(page.skip, page.skip + page.take);
    const pageIds = pageRows.map((r) => r.id);
    const found = pageIds.length
      ? await this.prisma.issue.findMany({
          where: { id: { in: pageIds } },
          select: ISSUE_LIST_SELECT,
        })
      : [];
    const byId = new Map(found.map((issue) => [issue.id, issue]));
    const views = await this.situation.viewsFromClassified(pageRows, {
      administratorId: user.administratorId!,
    });
    const items: IssueListItemDto[] = pageIds.flatMap((id) => {
      const issue = byId.get(id);
      const view = views.get(id);
      return issue
        ? [
            {
              ...issue,
              description: firstLine(issue.description),
              situationView: view ?? null,
            },
          ]
        : [];
    });
    const asset = query.assetId
      ? await this.prisma.asset.findFirst({
          where: { id: query.assetId, estateId: scope.estateId },
          select: { id: true, name: true },
        })
      : null;
    return {
      ...toPage(rows.length, page, items),
      summary: counts,
      asset,
    };
  }
}

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? ''
  );
}

/** Primer día incluido de un filtro de fecha de alta («últimos 7 días», «este año»). */
function createdSince(created: IssuesQueryDto['created'], now = new Date()) {
  if (!created) return undefined;
  if (created === 'year') return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = { '7d': 7, '30d': 30, '90d': 90 }[created];
  return new Date(now.getTime() - days * 86_400_000);
}

const STATUS_ORDER = [
  'Abierta',
  'EnReparacion',
  'PendienteProveedor',
  'PendienteInformacion',
  'Resuelta',
  'Cerrada',
  'Retirada',
];
/** Más urgente primero: lo que pide algo al administrador, luego lo que está en marcha y por último lo terminado. */
const SITUATION_ORDER = [
  'requires_attention',
  'stalled',
  'waiting_third_party',
  'no_pending_action',
  'completed',
];

/**
 * Ordena el resultado de la proyección por la columna pedida (`<campo>_asc|desc`). `newest` y `oldest` ya vienen
 * ordenados por fecha; el resto de empates conserva ese orden (el sort es estable).
 */
function sortClassified<T extends ClassifiedIssue>(
  rows: T[],
  sort: IssuesQueryDto['sort'],
): T[] {
  if (!sort || sort === 'newest' || sort === 'oldest') return rows;
  const [field, dir] = sort.split('_');
  const rank = (list: readonly string[], value: string) => {
    const i = list.indexOf(value);
    return i === -1 ? list.length : i;
  };
  const key = (row: T): string | number => {
    switch (field) {
      case 'ref':
        return row.ref;
      case 'title':
        return row.title;
      case 'estate':
        return row.estateName;
      case 'status':
        return rank(STATUS_ORDER, row.status);
      case 'situation':
        return rank(SITUATION_ORDER, row.situation);
      default:
        return rank(BALL_PARTIES, row.ball);
    }
  };
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return (
      sign *
      (typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), 'es', { numeric: true }))
    );
  });
}
