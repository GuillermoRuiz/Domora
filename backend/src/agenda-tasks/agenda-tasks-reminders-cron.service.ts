import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MAX_REMINDER_MINUTES, OPEN_STATUSES } from './agenda-task.constants';
import {
  localMidnightOf,
  occurrencesBetween,
  seriesSpecOf,
} from './recurrence';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Un recordatorio atrasado (caída del servicio) se emite hasta 1 h tarde; después ya no tiene sentido. */
const GRACE_MS = HOUR_MS;
/** Una tarea de día completo "empieza" a medianoche local: hasta 14 h antes de la UTC que se guarda. */
const ALL_DAY_SLACK_MS = 14 * HOUR_MS;
const BATCH_SIZE = 500;
/** Ocurrencias que se miran por tarea y pasada (cubre 7 días de antelación sobre una serie diaria). */
const OCCURRENCES_PER_TASK = 20;
/** Los registros de recordatorios emitidos se conservan este tiempo (solo sirven para no repetir). */
const REMINDER_LOG_RETENTION_DAYS = 30;

function describeWhen(start: Date, timezone: string, allDay: boolean): string {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: allDay ? 'UTC' : timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(allDay ? {} : { hour: '2-digit', minute: '2-digit' }),
  }).format(start);
}

/**
 * Emite los recordatorios de las tareas de la agenda como avisos en la
 * bandeja (`NotificationsService`, categoría `task`; el email sigue las
 * preferencias de cada usuario). Cada minuto busca las ocurrencias con
 * recordatorio cuyo momento ya llegó.
 *
 * Garantía: UNA ocurrencia + UN recordatorio = como máximo UN aviso, aunque el
 * cron corra varias veces, se reinicie el servidor, haya varias réplicas o se
 * edite la tarea. Lo asegura la clave primaria (tarea, inicio de ocurrencia)
 * de `agenda_task_reminders`: solo quien consigue insertar la fila envía el
 * aviso (`INSERT … ON CONFLICT DO NOTHING`, atómico en Postgres). Si el envío
 * falla después, el aviso se pierde en vez de repetirse (como mucho una vez).
 *
 * Al reprogramar una tarea cambia el inicio de su ocurrencia, así que el nuevo
 * momento recibe su propio aviso; un recordatorio cuyo momento ya había pasado
 * al crear o editar la tarea no se emite retroactivamente.
 */
@Injectable()
export class AgendaTasksRemindersCronService {
  private readonly logger = new Logger(AgendaTasksRemindersCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    try {
      await this.remindDue(new Date());
    } catch (error) {
      this.logger.error('Error emitiendo recordatorios de tareas', error);
    }
  }

  /** Limpieza diaria del registro de recordatorios ya emitidos. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    try {
      const limit = new Date(Date.now() - REMINDER_LOG_RETENTION_DAYS * DAY_MS);
      await this.prisma.agendaTaskReminder.deleteMany({
        where: { occurrenceStart: { lt: limit } },
      });
    } catch (error) {
      this.logger.error('Error limpiando recordatorios antiguos', error);
    }
  }

  /** Devuelve cuántos recordatorios emitió (útil en tests). */
  async remindDue(now: Date): Promise<number> {
    const windowStart = new Date(now.getTime() - GRACE_MS);
    const horizon = new Date(
      now.getTime() + (MAX_REMINDER_MINUTES + 60) * MINUTE_MS,
    );
    const earliest = new Date(windowStart.getTime() - ALL_DAY_SLACK_MS);
    const resolvedOrSent = {
      where: { occurrenceStart: { gte: earliest, lte: horizon } },
      select: { occurrenceStart: true },
    } as const;

    const candidates = await this.prisma.agendaTask.findMany({
      where: {
        reminderMinutesBefore: { not: null },
        archivedAt: null,
        status: { in: OPEN_STATUSES },
        OR: [
          { recurrenceFreq: null, startAt: { gte: earliest, lte: horizon } },
          {
            recurrenceFreq: { not: null },
            startAt: { lte: horizon },
            OR: [
              { recurrenceUntil: null },
              { recurrenceUntil: { gte: earliest } },
            ],
          },
        ],
      },
      select: {
        id: true,
        title: true,
        estateId: true,
        assignedToUserId: true,
        createdByUserId: true,
        startAt: true,
        endAt: true,
        allDay: true,
        timezone: true,
        recurrenceFreq: true,
        recurrenceInterval: true,
        recurrenceUntil: true,
        reminderMinutesBefore: true,
        updatedAt: true,
        occurrences: resolvedOrSent,
        reminders: resolvedOrSent,
      },
      orderBy: { startAt: 'asc' },
      take: BATCH_SIZE,
    });

    let sent = 0;
    for (const task of candidates) {
      // Las tareas que abre Domora no tienen autor: sin responsable, nadie a quien recordar.
      const recipient = task.assignedToUserId ?? task.createdByUserId;
      if (!recipient) continue;
      const lead = (task.reminderMinutesBefore ?? 0) * MINUTE_MS;
      const resolved = new Set(
        task.occurrences.map((o) => o.occurrenceStart.getTime()),
      );
      const alreadySent = new Set(
        task.reminders.map((r) => r.occurrenceStart.getTime()),
      );
      const occurrences = occurrencesBetween(
        seriesSpecOf(task),
        new Date(earliest.getTime() - DAY_MS),
        new Date(horizon.getTime() + DAY_MS),
        OCCURRENCES_PER_TASK,
      );

      for (const occurrence of occurrences) {
        const key = occurrence.start.getTime();
        if (resolved.has(key) || alreadySent.has(key)) continue;
        // Día completo: su momento es la medianoche local de su zona.
        const startInstant = task.allDay
          ? localMidnightOf(occurrence.start, task.timezone)
          : occurrence.start;
        const remindAt = startInstant.getTime() - lead;
        if (startInstant.getTime() < windowStart.getTime()) continue;
        if (remindAt > now.getTime()) continue;
        // El recordatorio ya había pasado cuando se creó/editó la tarea: no avisa.
        if (remindAt < task.updatedAt.getTime() - MINUTE_MS) continue;

        // Cerrojo en BD: solo el INSERT que gana la carrera envía el aviso.
        const claimed = await this.prisma.agendaTaskReminder.createMany({
          data: [{ taskId: task.id, occurrenceStart: occurrence.start }],
          skipDuplicates: true,
        });
        if (claimed.count === 0) continue;

        await this.notifications.notify({
          userIds: [recipient],
          category: 'task',
          title: `Recordatorio: ${task.title}`,
          body: describeWhen(occurrence.start, task.timezone, task.allDay),
          link: { B: `/b/tasks?task=${task.id}` },
          estateId: task.estateId,
          // Por ocurrencia: el aviso de una no debe ocultar (ni suprimir el email) del siguiente.
          dedupeKey: `agenda-task:${task.id}:${key}`,
        });
        sent += 1;
      }
    }
    return sent;
  }
}
