import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { IssueStatus, Prisma } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PropertyAccessService } from '../estate-access/property-access.service';
import { isTerminalIssueStatus } from '../issue-workflow/issue-situation';
import { issueEventData } from '../issue-workflow/issue-events.service';
import { IssueWorkflowService } from '../issue-workflow/issue-workflow.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateOwnerIssueDto,
  ListOwnerIssuesQuery,
  OwnerIssueReplyDto,
  RateIssueDto,
} from './dto/owner-issue.dto';
import { issuesOfEstate } from './issue-estate';
import { presentIssueForResident } from './issue-resident-view';
import { RESOLVED_ISSUE_STATUSES } from './issue-status.constants';
import { IssuesService } from './issues.service';

const OPEN: IssueStatus[] = ['Abierta', 'PendienteInformacion'];
const IN_PROGRESS: IssueStatus[] = ['EnReparacion', 'PendienteProveedor'];
const DAY_MS = 86_400_000;
/** «Resueltas» cuenta los últimos 6 meses; una resolución se puede reabrir durante 7 días. */
const RESOLVED_WINDOW_DAYS = 182;
const REOPEN_WINDOW_DAYS = 7;
/** Zonas que toda comunidad tiene, ofrecidas tras sus instalaciones, portales y zonas reservables. */
const COMMON_AREAS = ['Zona común', 'Garaje', 'Ascensor', 'Fachada y cubierta'];

/** Cuánto suele tardar la gestión en contestar, para mostrarlo en la ficha. */
function expectedResponseHours(issue: { priority: string }): number {
  return issue.priority === 'Urgente' ? 24 : 72;
}

/**
 * «Incidencias» del propietario (rol C). Una incidencia es de la COMUNIDAD: el propietario ve las de todas las
 * comunidades de las que es miembro ACTIVO (comprobado en la base de datos) con la proyección pública de siempre —sin proveedor,
 * presupuesto, instalación ni notas internas, y con los demás vecinos anónimos—. Su vivienda solo prueba que es miembro: no
 * se guarda en la incidencia ni es su ubicación. `mine` significa «he reportado esta incidencia» (existe un `IssueReport`
 * suyo); solo quien la reportó escribe, responde, retira, reabre o valora. «Me afecta también» no convierte en reportante.
 */
@Injectable()
export class OwnerIssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly propertyAccess: PropertyAccessService,
    private readonly notifications: NotificationsService,
    private readonly issues: IssuesService,
    private readonly workflow: IssueWorkflowService,
  ) {}

  async list(user: AuthenticatedUser, query: ListOwnerIssuesQuery) {
    const estateIds = await this.propertyAccess.activeEstateIds(user);
    if (query.estateId && !estateIds.includes(query.estateId))
      throw new NotFoundException('Comunidad no encontrada.');
    const base: Prisma.IssueWhereInput = {
      deletedAt: null,
      ...issuesOfEstate(query.estateId ?? estateIds),
    };
    const q = query.q?.trim();
    const filtered: Prisma.IssueWhereInput = {
      AND: [
        base,
        q
          ? {
              OR: [
                { title: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } },
                { location: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        query.status?.length ? { status: { in: query.status } } : {},
      ],
    };
    const resolvedSince = new Date(Date.now() - RESOLVED_WINDOW_DAYS * DAY_MS);
    const [rows, open, inProgress, resolved] = await Promise.all([
      this.prisma.issue.findMany({
        where: filtered,
        include: {
          estate: { select: { name: true } },
          affected: { select: { userId: true } },
          reports: { where: { reporterUserId: user.id }, select: { id: true } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.issue.count({
        where: { AND: [base, { status: { in: OPEN } }] },
      }),
      this.prisma.issue.count({
        where: { AND: [base, { status: { in: IN_PROGRESS } }] },
      }),
      this.prisma.issue.count({
        where: {
          AND: [
            base,
            { status: { in: RESOLVED_ISSUE_STATUSES } },
            { resolvedAt: { gte: resolvedSince } },
          ],
        },
      }),
    ]);
    return {
      items: rows.map((issue) => {
        const mine = issue.reports.length > 0;
        return {
          id: issue.id,
          ref: issue.ref,
          estateId: issue.estateId,
          estateName: issue.estate.name,
          title: issue.title,
          description: issue.description,
          type: issue.type,
          location: issue.location,
          status: issue.status,
          priority: issue.priority,
          date: issue.date,
          mine,
          awaitingMyAnswer: mine && issue.status === 'PendienteInformacion',
          affectedCount: issue.affected.length,
          affectedByMe: issue.affected.some((a) => a.userId === user.id),
        };
      }),
      kpis: { open, inProgress, resolved },
    };
  }

  async detail(id: string, user: AuthenticatedUser) {
    const issue = await this.prisma.issue.findFirst({
      where: { id, deletedAt: null },
      include: {
        estate: { select: { name: true } },
        photos: { orderBy: { uploadedAt: 'asc' } },
        affected: { select: { userId: true } },
        reports: { select: { reporterUserId: true } },
        timeline: {
          where: { internal: false },
          orderBy: { date: 'asc' },
          include: { authorUser: { select: { fullName: true } } },
        },
      },
    });
    // Quien no es miembro activo recibe lo mismo que si no existiera.
    if (
      !issue ||
      !(await this.propertyAccess.isActiveMember(issue.estateId, user))
    )
      throw new NotFoundException(`Incidencia ${id} no encontrada.`);
    const mine = issue.reports.some((r) => r.reporterUserId === user.id);
    const othersInterested =
      issue.reports.some((r) => r.reporterUserId !== user.id) ||
      issue.affected.length > 0;
    const resolvedRecently =
      !!issue.resolvedAt &&
      issue.resolvedAt.getTime() >= Date.now() - REOPEN_WINDOW_DAYS * DAY_MS;
    const terminal = isTerminalIssueStatus(issue.status);
    return {
      ...presentIssueForResident(issue, user.id, mine),
      estateName: issue.estate.name,
      mine,
      // Solo quien reportó ve los metadatos de los adjuntos; el resto de vecinos no los recibe.
      attachments: mine
        ? issue.photos.map((p) => ({
            id: p.id,
            fileName: p.fileName,
            mimeType: p.mimeType,
            size: p.size,
            uploadedAt: p.uploadedAt,
          }))
        : [],
      affectedCount: issue.affected.length,
      affectedByMe: issue.affected.some((a) => a.userId === user.id),
      awaitingMyAnswer: mine && issue.status === 'PendienteInformacion',
      expectedResponseHours: expectedResponseHours(issue),
      canReply: mine && !terminal,
      // Retirar la incidencia de otros vecinos no es de uno solo: con más reportantes o afectados, se pide a la administración.
      canWithdraw: mine && issue.status === 'Abierta' && !othersInterested,
      withdrawBlockedByOthers:
        mine && issue.status === 'Abierta' && othersInterested,
      canReopen: mine && issue.status === 'Resuelta' && resolvedRecently,
      canRate:
        mine &&
        RESOLVED_ISSUE_STATUSES.includes(issue.status) &&
        issue.rating === null,
      canMarkAffected: !mine && !terminal,
    };
  }

  /** Reutiliza el alta de la gestión (ref, seguimiento, IA); quien avisa queda como reportante en `IssueReport`. */
  async create(dto: CreateOwnerIssueDto, user: AuthenticatedUser) {
    const created = await this.issues.create(
      dto.estateId,
      {
        type: dto.type ?? 'Otro',
        title: dto.title.trim(),
        description: dto.description.trim(),
        location: dto.location,
        priority: dto.urgent ? 'Urgente' : 'Normal',
      },
      user,
    );
    return this.detail(created.id, user);
  }

  /**
   * Dónde puede ocurrir: las instalaciones de la comunidad, sus portales, sus zonas reservables y las zonas comunes habituales.
   * Nunca la vivienda de quien avisa.
   */
  async locations(estateId: string, user: AuthenticatedUser) {
    await this.assertMember(estateId, user);
    const [assets, blocks, amenities] = await Promise.all([
      this.prisma.asset.findMany({
        where: { estateId },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.property.findMany({
        where: { estateId, deletedAt: null, block: { not: null } },
        select: { block: true },
        distinct: ['block'],
        orderBy: { block: 'asc' },
      }),
      this.prisma.amenity.findMany({
        where: { estateId },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const labels = [
      ...COMMON_AREAS.slice(0, 1),
      ...assets.map((a) => a.name),
      ...blocks.map((b) => `Portal ${b.block}`),
      ...amenities.map((a) => a.name),
      ...COMMON_AREAS.slice(1),
    ];
    const seen = new Set<string>();
    return labels
      .filter((label) => {
        const key = label.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((label) => ({ label }));
  }

  /** Incidencias abiertas de la comunidad que comparten una palabra con el asunto: «Me afecta también» en vez de un duplicado. */
  async similar(estateId: string, text: string, user: AuthenticatedUser) {
    await this.assertMember(estateId, user);
    const words = [
      ...new Set(
        text
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .filter((w) => w.length >= 4),
      ),
    ].slice(0, 8);
    if (words.length === 0) return [];
    const rows = await this.prisma.issue.findMany({
      where: {
        deletedAt: null,
        ...issuesOfEstate(estateId),
        status: { in: [...OPEN, ...IN_PROGRESS] },
        OR: words.map((w) => ({
          title: { contains: w, mode: 'insensitive' as const },
        })),
      },
      include: {
        affected: { select: { userId: true } },
        reports: { where: { reporterUserId: user.id }, select: { id: true } },
      },
      orderBy: { date: 'desc' },
      take: 5,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      location: r.location,
      mine: r.reports.length > 0,
      affectedCount: r.affected.length,
      affectedByMe: r.affected.some((a) => a.userId === user.id),
    }));
  }

  /**
   * Quien reportó añade información o contesta. Si la gestión pidió información, la respuesta restaura el estado en el que
   * estaba la incidencia (`statusBeforeInfoRequest`) y deja constancia; en cualquier caso la gestión recibe la novedad como
   * con cualquier nota de quien reporta.
   */
  async reply(id: string, dto: OwnerIssueReplyDto, user: AuthenticatedUser) {
    const issue = await this.assertMine(id, user);
    if (isTerminalIssueStatus(issue.status))
      throw new BadRequestException('La incidencia ya está cerrada.');
    if (issue.status !== 'PendienteInformacion') {
      await this.issues.addTimelineEntry(id, { text: dto.text }, user);
      return this.detail(id, user);
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.workflow.lockIssue(tx, id);
      const current = await tx.issue.findUniqueOrThrow({ where: { id } });
      if (isTerminalIssueStatus(current.status))
        throw new BadRequestException('La incidencia ya está cerrada.');
      const waiting = current.status === 'PendienteInformacion';
      const now = new Date();
      await tx.issueTimelineEntry.create({
        data: {
          issueId: id,
          ...issueEventData({
            kind: waiting ? 'info_provided' : 'note',
            actorKind: 'person',
            authorUserId: user.id,
            role: 'Propietario',
            date: now,
            text: dto.text,
          }),
        },
      });
      if (waiting) {
        const back = current.statusBeforeInfoRequest ?? 'Abierta';
        await tx.issue.update({
          where: { id },
          data: { status: back, statusBeforeInfoRequest: null },
        });
        await tx.issueTimelineEntry.create({
          data: {
            issueId: id,
            ...issueEventData({
              kind: 'status_changed',
              actorKind: 'person',
              authorUserId: user.id,
              role: 'Propietario',
              date: new Date(now.getTime() + 1),
              fromStatus: current.status,
              toStatus: back,
              text: 'Información aportada por quien avisó.',
            }),
          },
        });
      }
      return this.workflow.requesterNoteReceived(tx, id);
    });
    await this.workflow.notifyRequesterNote(outcome);
    return this.detail(id, user);
  }

  /**
   * Retirar: solo quien reportó, mientras está abierta, y solo si nadie más tiene interés en ella (otro reportante o alguien que
   * marcó «me afecta también»: 409). Es un estado terminal que NO es una resolución; se liquida como cualquier otro (esperas,
   * tareas, mensajes sin enviar, jobs y visitas) y, con un siniestro de seguro vivo, se rechaza igual que cerrar.
   */
  async withdraw(id: string, user: AuthenticatedUser) {
    const issue = await this.assertMine(id, user);
    await this.prisma.$transaction(async (tx) => {
      await this.workflow.lockIssue(tx, id);
      const current = await tx.issue.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'Abierta')
        throw new BadRequestException(
          'Solo se puede retirar mientras está abierta.',
        );
      const [others, affected] = await Promise.all([
        tx.issueReport.count({
          where: {
            issueId: id,
            OR: [
              { reporterUserId: null },
              { reporterUserId: { not: user.id } },
            ],
          },
        }),
        tx.issueAffectedUser.count({ where: { issueId: id } }),
      ]);
      if (others > 0 || affected > 0)
        throw new ConflictException({
          code: 'ISSUE_HAS_OTHER_INTERESTED',
          message:
            'No se puede retirar: otros vecinos también la han reportado o les afecta. Contacta con la administración.',
        });
      await this.issues.applyStatusInTx(tx, current, 'Retirada', user);
    });
    await this.notifyManagers(
      issue,
      `Incidencia retirada: ${issue.title}`,
      null,
    );
    return this.detail(id, user);
  }

  async reopen(id: string, user: AuthenticatedUser) {
    const issue = await this.assertMine(id, user);
    await this.prisma.$transaction(async (tx) => {
      await this.workflow.lockIssue(tx, id);
      const current = await tx.issue.findUniqueOrThrow({ where: { id } });
      const recent =
        !!current.resolvedAt &&
        current.resolvedAt.getTime() >=
          Date.now() - REOPEN_WINDOW_DAYS * DAY_MS;
      if (current.status !== 'Resuelta' || !recent)
        throw new BadRequestException(
          `Solo se puede reabrir durante los ${REOPEN_WINDOW_DAYS} días siguientes a su resolución.`,
        );
      await this.issues.applyStatusInTx(tx, current, 'Abierta', user);
    });
    await this.notifyManagers(
      issue,
      `Incidencia reabierta: ${issue.title}`,
      null,
    );
    return this.detail(id, user);
  }

  async rate(id: string, dto: RateIssueDto, user: AuthenticatedUser) {
    const issue = await this.assertMine(id, user);
    if (!RESOLVED_ISSUE_STATUSES.includes(issue.status))
      throw new BadRequestException('Solo se valora una incidencia resuelta.');
    if (issue.rating !== null)
      throw new BadRequestException('Esta incidencia ya está valorada.');
    const { count } = await this.prisma.issue.updateMany({
      where: { id, rating: null },
      data: { rating: dto.rating, ratingComment: dto.comment?.trim() || null },
    });
    if (count === 0)
      throw new BadRequestException('Esta incidencia ya está valorada.');
    return this.detail(id, user);
  }

  /**
   * «Me afecta también» en la incidencia de otro vecino. No convierte en reportante (no hay `IssueReport`) ni da sus permisos.
   */
  async setAffected(id: string, affected: boolean, user: AuthenticatedUser) {
    const detail = await this.detail(id, user);
    if (detail.mine)
      throw new BadRequestException('Esta incidencia ya es tuya.');
    if (affected) {
      if (!detail.canMarkAffected)
        throw new BadRequestException('Esta incidencia ya está cerrada.');
      await this.prisma.issueAffectedUser.upsert({
        where: { issueId_userId: { issueId: id, userId: user.id } },
        create: { issueId: id, userId: user.id },
        update: {},
      });
    } else {
      await this.prisma.issueAffectedUser.deleteMany({
        where: { issueId: id, userId: user.id },
      });
    }
    return this.detail(id, user);
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private async assertMember(estateId: string, user: AuthenticatedUser) {
    if (!(await this.propertyAccess.isActiveMember(estateId, user)))
      throw new NotFoundException('Comunidad no encontrada.');
  }

  /** Una incidencia de la comunidad del usuario, y que él reportó (visible pero ajena = prohibido; invisible = no existe). */
  private async assertMine(id: string, user: AuthenticatedUser) {
    const issue = await this.issues.assertIssueAccess(id, user);
    if (!(await this.issues.isReporter(id, user.id)))
      throw new ForbiddenException(
        'Solo quien reportó la incidencia puede actuar sobre ella.',
      );
    return issue;
  }

  private async notifyManagers(
    issue: { id: string; estateId: string; title: string },
    title: string,
    body: string | null,
  ) {
    const managers = await this.notifications.managerIdsOfEstate(
      issue.estateId,
    );
    await this.notifications.notify({
      userIds: managers,
      category: 'issue',
      title,
      body,
      link: `/b/incidencias/${issue.id}`,
      estateId: issue.estateId,
    });
  }
}
