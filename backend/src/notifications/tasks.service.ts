import { issuesOfEstate } from '../issues/issue-estate';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Tareas pendientes de la gestora (y de soporte). A diferencia de un AVISO
 * (`Notification`, un evento con estado leído/no leído), una tarea es un
 * ESTADO: "hay 3 solicitudes de adhesión sin resolver". Por eso se deriva al
 * vuelo en cada consulta — no se persiste, no se marca como leída y
 * desaparece sola cuando se resuelve.
 *
 * Una fila por (finca, tipo) con su recuento, no una por registro: es una
 * lista de trabajo, no un listado de entidades.
 */
export type TaskKind =
  | 'onboarding_requests'
  | 'adhesion_requests'
  | 'issues_open'
  | 'inspections_overdue'
  | 'inspections_due_soon'
  | 'corrective_actions_overdue'
  | 'meetings_to_close';

export interface TaskItem {
  kind: TaskKind;
  estateId: string | null;
  estateName: string | null;
  title: string;
  count: number;
  /** Ruta del frontend donde se resuelve. */
  link: string;
}

/** Ventana de "inspecciones próximas a vencer". */
const INSPECTION_DUE_SOON_DAYS = 30;

/** Orden de aparición: primero lo que bloquea a otras personas. */
const KIND_ORDER: TaskKind[] = [
  'onboarding_requests',
  'adhesion_requests',
  'meetings_to_close',
  'inspections_overdue',
  'corrective_actions_overdue',
  'issues_open',
  'inspections_due_soon',
];

/** Fecha sin hora, en UTC (mismo criterio que `InspectionsCronService`). */
function startOfTodayUtc(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser): Promise<TaskItem[]> {
    if (user.role === 'A') return this.listForSupport();
    if (user.role !== 'B') return [];
    return this.listForManager(user.estateIds);
  }

  async countPending(user: AuthenticatedUser): Promise<number> {
    const tasks = await this.list(user);
    return tasks.reduce((total, t) => total + t.count, 0);
  }

  /** Soporte: solo las altas de comunidad nueva, que son suyas de resolver. */
  private async listForSupport(): Promise<TaskItem[]> {
    const count = await this.prisma.estateOnboardingRequest.count({
      where: { status: 'pending' },
    });
    if (count === 0) return [];
    return [
      {
        kind: 'onboarding_requests',
        estateId: null,
        estateName: null,
        title: this.plural(
          count,
          'solicitud de alta de comunidad',
          'solicitudes de alta de comunidad',
        ),
        count,
        link: '/a/admins',
      },
    ];
  }

  private async listForManager(estateIds: string[]): Promise<TaskItem[]> {
    if (estateIds.length === 0) return [];
    const now = new Date();
    const today = startOfTodayUtc(now);
    const dueSoonLimit = new Date(
      today.getTime() + INSPECTION_DUE_SOON_DAYS * 86_400_000,
    );

    const [adhesions, issues, inspections, actions, meetings, estates] =
      await Promise.all([
        this.prisma.adhesionRequest.groupBy({
          by: ['estateId'],
          where: { estateId: { in: estateIds }, status: 'pending' },
          _count: { _all: true },
        }),
        // Incidencias sin atender por finca (`Issue.estateId`: las de vivienda y las comunes).
        this.prisma.issue.findMany({
          where: {
            deletedAt: null,
            status: 'Abierta',
            ...issuesOfEstate(estateIds),
          },
          select: { estateId: true },
        }),
        this.prisma.regulatoryInspection.findMany({
          where: {
            estateId: { in: estateIds },
            OR: [
              { status: 'vencida' },
              {
                status: { in: ['planificada', 'citada'] },
                nextDueDate: { lte: dueSoonLimit },
              },
            ],
          },
          select: { estateId: true, status: true, nextDueDate: true },
        }),
        this.prisma.correctiveAction.findMany({
          where: {
            inspection: { estateId: { in: estateIds } },
            OR: [
              { status: 'vencida' },
              {
                status: { in: ['abierta', 'en_progreso'] },
                dueDate: { lt: today },
              },
            ],
          },
          select: { inspection: { select: { estateId: true } } },
        }),
        this.prisma.meeting.findMany({
          where: {
            estateId: { in: estateIds },
            status: 'convocada',
            scheduledAt1: { lt: now },
          },
          select: { estateId: true },
        }),
        this.prisma.estate.findMany({
          where: { id: { in: estateIds }, deletedAt: null },
          select: { id: true, name: true },
        }),
      ]);

    const names = new Map(estates.map((e) => [e.id, e.name]));
    const tasks: TaskItem[] = [];
    const push = (
      kind: TaskKind,
      estateId: string,
      count: number,
      title: string,
      tab: string,
    ) => {
      if (count === 0 || !names.has(estateId)) return;
      tasks.push({
        kind,
        estateId,
        estateName: names.get(estateId) ?? null,
        title,
        count,
        link: `/b/estates/${estateId}?tab=${tab}`,
      });
    };

    for (const row of adhesions) {
      const n = row._count._all;
      push(
        'adhesion_requests',
        row.estateId,
        n,
        this.plural(
          n,
          'solicitud de adhesión pendiente',
          'solicitudes de adhesión pendientes',
        ),
        'requests',
      );
    }
    for (const [estateId, n] of this.countBy(issues.map((i) => i.estateId))) {
      push(
        'issues_open',
        estateId,
        n,
        this.plural(n, 'incidencia sin atender', 'incidencias sin atender'),
        'issues',
      );
    }

    const overdueInspections: string[] = [];
    const dueSoonInspections: string[] = [];
    for (const i of inspections) {
      // Aún no las ha pasado a `vencida` el cron diario, pero ya lo están.
      const overdue =
        i.status === 'vencida' ||
        (i.nextDueDate !== null && i.nextDueDate < today);
      (overdue ? overdueInspections : dueSoonInspections).push(i.estateId);
    }
    for (const [estateId, n] of this.countBy(overdueInspections)) {
      push(
        'inspections_overdue',
        estateId,
        n,
        this.plural(n, 'inspección vencida', 'inspecciones vencidas'),
        'inspections',
      );
    }
    for (const [estateId, n] of this.countBy(dueSoonInspections)) {
      push(
        'inspections_due_soon',
        estateId,
        n,
        this.plural(
          n,
          `inspección vence en menos de ${INSPECTION_DUE_SOON_DAYS} días`,
          `inspecciones vencen en menos de ${INSPECTION_DUE_SOON_DAYS} días`,
        ),
        'inspections',
      );
    }
    for (const [estateId, n] of this.countBy(
      actions.map((a) => a.inspection.estateId),
    )) {
      push(
        'corrective_actions_overdue',
        estateId,
        n,
        this.plural(
          n,
          'acción correctiva vencida',
          'acciones correctivas vencidas',
        ),
        'inspections',
      );
    }
    for (const [estateId, n] of this.countBy(meetings.map((m) => m.estateId))) {
      push(
        'meetings_to_close',
        estateId,
        n,
        this.plural(
          n,
          'junta pendiente de cerrar',
          'juntas pendientes de cerrar',
        ),
        'juntas',
      );
    }

    return tasks.sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        (a.estateName ?? '').localeCompare(b.estateName ?? ''),
    );
  }

  /** Cuenta por clave; ignora los `null` (viviendas aún sin finca). */
  private countBy(keys: (string | null)[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const key of keys) {
      if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private plural(n: number, singular: string, plural: string): string {
    return `${n} ${n === 1 ? singular : plural}`;
  }
}
