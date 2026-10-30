import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';

export type ReserveFundUseReason =
  | 'conservacion'
  | 'reparacion'
  | 'rehabilitacion'
  | 'accesibilidad'
  | 'eficiencia_energetica'
  | 'seguro_danos'
  | 'mantenimiento_permanente'
  | 'otro';

export const RESERVE_FUND_USE_REASON_LABELS: Record<ReserveFundUseReason, string> = {
  conservacion: 'Conservación',
  reparacion: 'Reparación',
  rehabilitacion: 'Rehabilitación',
  accesibilidad: 'Accesibilidad',
  eficiencia_energetica: 'Eficiencia energética',
  seguro_danos: 'Seguro de daños',
  mantenimiento_permanente: 'Mantenimiento permanente',
  otro: 'Otro',
};

export interface ReserveFundApplication {
  id: string;
  date: string;
  amount: number;
  reason: ReserveFundUseReason;
  concept: string;
  meetingReference: string;
  relatedSupplierInvoiceNumber: string | null;
  relatedPayrollPeriod: string | null;
  entryNumber: number;
  status: 'Vigente' | 'Deshecha';
  cancelReason: string | null;
}

/**
 * Uso del fondo de reserva (art. 9.1.f LPH): 117 → 746, con motivo (de la
 * lista que permite la ley) y acta obligatorios — a diferencia de la
 * política de intereses, donde la referencia al acta es opcional, acá el
 * fondo tiene "una finalidad totalmente independiente" de los gastos
 * ordinarios y no hay otro trámite que deje esa traza.
 */
@Injectable({ providedIn: 'root' })
export class ReserveFundService {
  private api = inject(ApiClientService);

  async list(estateId: string): Promise<ReserveFundApplication[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/reserve-fund-applications`);
    return rows.map((r) => ({ ...r, date: d(r.date) }));
  }

  async create(estateId: string, payload: {
    date: string;
    amount: number;
    reason: ReserveFundUseReason;
    concept: string;
    meetingReference: string;
    relatedSupplierInvoiceId?: string;
    relatedPayrollId?: string;
  }): Promise<void> {
    await this.api.post(`/estates/${estateId}/reserve-fund-applications`, payload);
  }

  async cancel(id: string, reason: string): Promise<void> {
    await this.api.post(`/reserve-fund-applications/${id}/cancel`, { reason });
  }
}
