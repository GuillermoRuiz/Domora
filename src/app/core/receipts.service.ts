import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d, PAY_METHOD_FROM_API, PAY_METHOD_TO_API } from './api-shared';
import { AccountingReceipt, RECEIPT_KIND_LABELS, ReceiptKind, ReceiptStatus } from './models';

/**
 * Unifica lo que en `data.service.ts` eran dos secciones separadas por
 * ~900 líneas ("Receipts (rol C proyección)" y "Receipts (rol B por
 * finca)") pero comparten el mismo `mapReceipt` y el mismo recurso —
 * distintas solo por quién llama, no por dominio.
 */
function mapReceipt(r: any): AccountingReceipt {
  return {
    ...r,
    periodKey: r.periodKey ?? r.period?.periodKey ?? '',
    period: typeof r.period === 'object' && r.period !== null ? (r.period.label ?? '') : (r.period ?? ''),
    unit: r.unit ?? r.property?.ref ?? '',
    owner: r.owner ?? r.ownerNameSnapshot ?? '',
    // Decimal de Prisma -> string por JSON, mismo motivo que mapEstate/
    // mapAccountingEstate. Sin este Number(...), recibos-tab.component.ts
    // sumaba r.amount con reduce((s, r) => s + r.amount, 0): con un string,
    // + concatena en vez de sumar, así que los totales del dashboard
    // (facturado/cobrado/pendiente/devuelto) salían mal.
    amount: Number(r.amount),
    outstanding: r.outstanding !== undefined && r.outstanding !== null ? Number(r.outstanding) : undefined,
    kindCode: r.kind as ReceiptKind,
    kind: RECEIPT_KIND_LABELS[r.kind as ReceiptKind] ?? r.kind ?? '',
    status: (r.status ?? '') as ReceiptStatus,
    method: PAY_METHOD_FROM_API[r.method] ?? r.method,
    date: d(r.date),
    dueDate: r.dueDate ? d(r.dueDate) : r.dueDate,
  };
}

@Injectable({ providedIn: 'root' })
export class ReceiptsService {
  private api = inject(ApiClientService);

  /** Rol C — "mis recibos", proyectados desde todas las fincas donde el usuario tiene propiedad. */
  async listReceiptsForUser(userId: string): Promise<AccountingReceipt[]> {
    const receipts = await this.api.get<any[]>(`/users/${userId}/receipts`);
    return receipts.map(mapReceipt);
  }

  /** Rol B — recibos de una finca concreta. */
  async listReceiptsByEstate(
    estateId: string,
    opts?: { periodKey?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<AccountingReceipt[]> {
    const res = await this.api.get<any>(`/estates/${estateId}/receipts`, {
      periodKey: opts?.periodKey,
      status: opts?.status,
      page: opts?.page,
      pageSize: opts?.pageSize ?? 200,
    });
    const items: any[] = Array.isArray(res) ? res : (res?.items ?? []);
    return items.map(mapReceipt);
  }

  /**
   * El backend devuelve el registro crudo de AccountingPeriod (campo
   * `periodKey`, no `key`) — sin este mapeo, `key` queda `undefined` en
   * cada elemento (el tipo de retorno mentía: era un passthrough sin
   * transformar nada). Causaba que "Nueva remesa" nunca pudiera generar
   * una remesa real: `cfg.period` terminaba en `undefined` y el POST a
   * /remesas fallaba validando `periodKey`.
   */
  async listAccountingPeriods(estateId: string): Promise<{ key: string; label: string; monthAbbrev?: string }[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/accounting/periods`);
    return rows.map(r => ({ key: r.periodKey, label: r.label, monthAbbrev: r.monthAbbrev }));
  }

  async generateReceipts(estateId: string, periodKey: string, label?: string, monthAbbrev?: string): Promise<{ created: number; skipped: number; totalProperties: number }> {
    return this.api.post<{ created: number; skipped: number; totalProperties: number }>(`/estates/${estateId}/receipts/generate`, { periodKey, label, monthAbbrev });
  }

  /**
   * Alta de UN recibo suelto — a diferencia de `generateReceipts` (masivo,
   * un recibo por propiedad), este crea uno solo para `propertyId`. Si
   * `periodKey` todavía no existe para la finca, el backend lo crea al
   * vuelo (mismo upsert que usa la generación masiva).
   */
  async createManualReceipt(estateId: string, payload: {
    propertyId: string;
    periodKey: string;
    label?: string;
    monthAbbrev?: string;
    concept: string;
    kind: ReceiptKind;
    amount: number;
    dueDate: string;
    method: string;
    includeInRemesa?: boolean;
  }): Promise<AccountingReceipt> {
    const raw = await this.api.post<any>(`/estates/${estateId}/receipts`, {
      ...payload,
      method: PAY_METHOD_TO_API[payload.method] ?? payload.method,
    });
    return mapReceipt(raw);
  }

  async updateReceipt(receiptId: string, patch: {
    status?: string; method?: string; returnCode?: string; returnReason?: string;
  }): Promise<void> {
    await this.api.patch(`/receipts/${receiptId}`, {
      ...patch,
      method: patch.method ? (PAY_METHOD_TO_API[patch.method] ?? patch.method) : undefined,
    });
  }

  /**
   * Anula un recibo emitido por error: el backend revierte su asiento de
   * emisión. Solo si no tiene cobros y no está en una remesa enviada.
   */
  async cancelReceipt(receiptId: string, reason: string): Promise<AccountingReceipt> {
    const raw = await this.api.post<any>(`/receipts/${receiptId}/cancel`, { reason });
    return mapReceipt(raw);
  }

  async uploadPaymentProof(receiptId: string, file: File): Promise<AccountingReceipt> {
    const raw = await this.api.uploadFile<any>(`/receipts/${receiptId}/payment-proof`, file);
    return mapReceipt(raw);
  }

  downloadPaymentProof(receiptId: string): Promise<Blob> {
    return this.api.getBlob(`/receipts/${receiptId}/payment-proof/file`);
  }
}
