import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';

/**
 * Una visita de la incidencia (`GET /issues/:id/visits`): la haga un proveedor del directorio, un profesional asignado, el que
 * envía la aseguradora o alguien solo con nombre. `overdue`: pasó su hora y sigue planificada (falta saber qué ocurrió).
 */
export interface IssueVisitView {
  id: string;
  status: 'planificada' | 'realizada' | 'cancelada';
  scheduledAt: string;
  purpose: string;
  notes: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  supplierId: string | null;
  assignmentId: string | null;
  professionalName: string | null;
  sentByInsurer: boolean;
  overdue: boolean;
}

/**
 * Visitas de una incidencia: verlas, dar su resultado, cancelar una futura y cambiarle la hora, SIN pasar por el panel del
 * proveedor. Todo va por la visita y la incidencia (nunca por proveedor), así que vale igual para un profesional sin ficha.
 */
@Injectable({ providedIn: 'root' })
export class IssueVisitsService {
  private readonly api = inject(ApiClientService);

  list(issueId: string): Promise<IssueVisitView[]> {
    return this.api.get<IssueVisitView[]>(`/issues/${issueId}/visits`);
  }

  /** «Se realizó» / «No se realizó o se canceló». Una visita realizada no resuelve la incidencia. */
  recordOutcome(issueId: string, visitId: string, outcome: 'completed' | 'cancelled'): Promise<{ visitId: string; status: string; followUp: boolean }> {
    return this.api.patch<{ visitId: string; status: string; followUp: boolean }>(`/issues/${issueId}/visits/${visitId}`, { outcome });
  }

  /** Nueva hora de una visita planificada (ISO, futura). */
  reschedule(issueId: string, visitId: string, scheduledAtIso: string): Promise<{ visitId: string; scheduledAt: string; changed: boolean }> {
    return this.api.patch<{ visitId: string; scheduledAt: string; changed: boolean }>(`/issues/${issueId}/visits/${visitId}/reschedule`, {
      scheduledAt: scheduledAtIso,
    });
  }
}
