import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import {
  ApplyResultOutcome, ClosePreconditionsView, FiscalYear, ReserveAllocationRule, ReserveMode, ResultApplicationTarget,
} from './models';

/** Ejercicio contable — aprobación en junta y cierre ("liquidación del ejercicio"). Un año nunca tocado llega como virtual (`id: null`), sin fila propia todavía. */
@Injectable({ providedIn: 'root' })
export class FiscalYearsService {
  private api = inject(ApiClientService);

  async listFiscalYears(estateId: string): Promise<FiscalYear[]> {
    return this.api.get<FiscalYear[]>(`/estates/${estateId}/fiscal-years`);
  }

  async approveFiscalYear(estateId: string, year: number, approvedNote?: string): Promise<FiscalYear> {
    return this.api.post<FiscalYear>(`/estates/${estateId}/fiscal-years/${year}/approve`, { approvedNote });
  }

  /** Fondo de reserva del ejercicio: afecta a los recibos que se emitan desde ahora. */
  async updateReserve(estateId: string, year: number, payload: {
    reserveMode: ReserveMode;
    reserveSharePct?: number | null;
    reserveAllocationRule?: ReserveAllocationRule | null;
    reserveAllocationValue?: number | null;
  }): Promise<FiscalYear> {
    return this.api.patch<FiscalYear>(`/estates/${estateId}/fiscal-years/${year}/reserve`, payload);
  }

  // ── Cierre de ejercicio real (fase 11) ──────────────────────────────────

  /** Bloqueos (impiden cerrar) y avisos (no impiden, pero conviene revisarlos) antes de cerrar. */
  closePreconditions(estateId: string, year: number): Promise<ClosePreconditionsView> {
    return this.api.get<ClosePreconditionsView>(`/estates/${estateId}/fiscal-years/${year}/close-preconditions`);
  }

  /** Regularización, dotación de reserva si aplica, cierre por dimensión y apertura del año siguiente — todo en un único paso irreversible salvo reapertura. */
  async closeFiscalYear(estateId: string, year: number): Promise<FiscalYear> {
    return this.api.post<FiscalYear>(`/estates/${estateId}/fiscal-years/${year}/close`, {});
  }

  /** Revierte el cierre (y la apertura del año siguiente) — solo si ese año siguiente no está también cerrado. */
  async reopenFiscalYear(estateId: string, year: number, reason: string): Promise<FiscalYear> {
    return this.api.post<FiscalYear>(`/estates/${estateId}/fiscal-years/${year}/reopen`, { reason });
  }

  /** Reclasifica el resultado del ejercicio cerrado a remanente o al fondo de reserva, tras la aprobación en junta. */
  async applyResult(estateId: string, year: number, target: ResultApplicationTarget): Promise<ApplyResultOutcome> {
    return this.api.post<ApplyResultOutcome>(`/estates/${estateId}/fiscal-years/${year}/apply-result`, { target });
  }
}
