import { BadRequestException } from '@nestjs/common';
import type { TaskDb } from './agenda-task-kind.types';

/**
 * Regla ÚNICA de quién puede ser responsable de una tarea: una persona del propio equipo de la gestora (rol B, no borrada).
 * La usan las tareas manuales (`AgendaTasksService`) y las que abre el workflow de incidencias.
 */
export async function assertTeamAssignee(
  db: Pick<TaskDb, 'user'>,
  administratorId: string,
  userId: string,
): Promise<void> {
  const assignee = await db.user.findFirst({
    where: { id: userId, administratorId, role: 'B', deletedAt: null },
    select: { id: true },
  });
  if (!assignee)
    throw new BadRequestException('El responsable no pertenece a tu equipo.');
}
