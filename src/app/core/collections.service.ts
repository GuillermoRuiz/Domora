import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d, PAY_METHOD_FROM_API, PAY_METHOD_TO_API } from './api-shared';
import { PropertyAccount, ReceiptHistory, ReceiptStatus, SuspenseItem } from './models';

/**
 * Cobros contabilizados: registrar lo que paga un propietario, deshacerlo,
 * registrar una devolución del banco, aplicar anticipos e ingresos sin
 * identificar. Los importes viajan en euros; el backend los convierte a
 * céntimos y contabiliza cada operación en el diario.
 */
@Injectable({ providedIn: 'root' })
export class CollectionsService {
  private api = inject(ApiClientService);

  /** Registra un cobro. Sin `receiptIds`, se imputa a lo más antiguo; lo que sobra queda como anticipo. */
  async registerCollection(estateId: string, input: {
    propertyId: string;
    date: string;
    amount: number;
    method: string;
    bankAccountId?: string;
    receiptIds?: string[];
    notes?: string;
  }): Promise<void> {
    await this.api.post(`/estates/${estateId}/collections`, {
      ...input,
      method: PAY_METHOD_TO_API[input.method] ?? input.method,
    });
  }

  /** Deshace un cobro registrado por error (contraasiento). */
  async undoCollection(collectionId: string, reason: string): Promise<void> {
    await this.api.post(`/collections/${collectionId}/undo`, { reason });
  }

  /** El banco devolvió el cobro: el recibo vuelve a deber y, si hay comisión, se contabiliza. */
  async returnCollection(collectionId: string, input: {
    date: string;
    returnCode?: string;
    returnReason?: string;
    feeAmount?: number;
    rechargeFee?: boolean;
  }): Promise<void> {
    await this.api.post(`/collections/${collectionId}/return`, input);
  }

  async receiptHistory(receiptId: string): Promise<ReceiptHistory> {
    const h = await this.api.get<any>(`/receipts/${receiptId}/history`);
    return {
      ...h,
      status: h.status as ReceiptStatus,
      movements: (h.movements ?? []).map((m: any) => ({
        ...m,
        date: d(m.date),
        method: m.method ? (PAY_METHOD_FROM_API[m.method] ?? m.method) : null,
        fromRemesa: Boolean(m.fromRemesa),
      })),
    };
  }

  async propertyAccount(estateId: string, propertyId: string): Promise<PropertyAccount> {
    const a = await this.api.get<any>(`/estates/${estateId}/property-accounts/${propertyId}`);
    return {
      ...a,
      openReceipts: (a.openReceipts ?? []).map((r: any) => ({ ...r, dueDate: r.dueDate ? d(r.dueDate) : null })),
    };
  }

  /** Aplica el anticipo de la propiedad a sus recibos pendientes. */
  async applyAdvance(estateId: string, propertyId: string, receiptIds?: string[]): Promise<{ applied: number }> {
    return this.api.post<{ applied: number }>(`/estates/${estateId}/advances/apply`, { propertyId, receiptIds });
  }

  async listSuspense(estateId: string): Promise<SuspenseItem[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/suspense`);
    return rows.map((i) => ({
      ...i,
      date: d(i.date),
      applications: (i.applications ?? []).map((a: any) => ({ ...a, date: d(a.date) })),
    }));
  }

  async registerSuspense(estateId: string, input: { date: string; amount: number; concept: string; bankAccountId?: string }): Promise<void> {
    await this.api.post(`/estates/${estateId}/suspense`, input);
  }

  async applySuspense(suspenseItemId: string, input: { propertyId: string; amount: number; date?: string }): Promise<void> {
    await this.api.post(`/suspense/${suspenseItemId}/apply`, input);
  }
}
