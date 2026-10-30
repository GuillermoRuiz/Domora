import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';
import { RemesaCandidate, RemesaHistoryItem, RemesaLine, RemesaStatus, Mandate, ReturnFile, ReturnFileItem } from './models';

const REMESA_STATUS_FROM_API: Record<string, RemesaStatus> = {
  Borrador: 'Borrador', Presentada: 'Presentada', Cobrada: 'Cobrada', ConDevoluciones: 'Con devoluciones', Anulada: 'Anulada',
};

function mapReturnItem(i: any): ReturnFileItem {
  const line = i.remesaLine;
  const p = line?.property;
  return {
    id: i.id,
    seq: i.seq,
    endToEndId: i.endToEndId ?? null,
    amount: i.amount !== null && i.amount !== undefined ? Number(i.amount) : null,
    date: i.date ? d(i.date) : null,
    returnCode: i.returnCode ?? null,
    returnReason: i.returnReason ?? null,
    feeAmount: i.feeAmount !== null && i.feeAmount !== undefined ? Number(i.feeAmount) : null,
    status: i.status,
    error: i.error ?? null,
    line: line
      ? {
          id: line.id,
          owner: line.ownerNameSnapshot ?? '',
          unit: p?.ref ?? ([p?.staircase, p?.floor, p?.door].filter(Boolean).join('-') || ''),
          receiptNo: line.receipt?.no ?? '',
          remesaConcept: line.remesa?.concept ?? '',
          amount: Number(line.amount),
        }
      : null,
  };
}

function mapReturnFile(f: any): ReturnFile {
  return {
    id: f.id,
    format: f.format,
    fileName: f.fileName,
    createdAt: f.createdAt,
    lastAppliedAt: f.lastAppliedAt ?? null,
    counts: f.counts,
    items: (f.items ?? []).map(mapReturnItem),
    ...(f.duplicate !== undefined ? { duplicate: f.duplicate } : {}),
    ...(f.summary ? { summary: f.summary } : {}),
  };
}

/** Remesas SEPA (Cuaderno 19) y los mandatos de domiciliación que las respaldan. */
@Injectable({ providedIn: 'root' })
export class SepaService {
  private api = inject(ApiClientService);

  // ── Remesas SEPA ─────────────────────────────────────────────────────────
  async listRemesas(estateId: string): Promise<RemesaHistoryItem[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/remesas`);
    return rows.map((r): RemesaHistoryItem => ({
      id: r.id,
      period: r.period?.label ?? r.period?.key ?? '',
      periodKey: r.period?.periodKey ?? '',
      scheme: r.scheme,
      count: r.linesCount,
      amount: Number(r.totalAmount),
      presented: d(r.presentedAt),
      charge: d(r.chargeDate),
      status: REMESA_STATUS_FROM_API[r.status] ?? r.status,
      charged: r.charged,
      returned: r.returned,
      pending: r.pending,
      returnedAmount: Number(r.returnedAmount),
    }));
  }

  async listRemesaCandidates(estateId: string, periodKey: string): Promise<RemesaCandidate[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/remesas/candidates`, { periodKey });
    return rows.map((c): RemesaCandidate => ({ ...c, id: c.receiptId, amount: Number(c.amount) }));
  }

  async createRemesa(estateId: string, input: {
    periodKey: string; chargeDate: string; scheme: string; concept: string; messageId?: string; excludeReceiptIds?: string[];
  }): Promise<any> {
    return this.api.post<any>(`/estates/${estateId}/remesas`, input);
  }

  getRemesaFile(remesaId: string): Promise<string> {
    return this.api.getText(`/remesas/${remesaId}/file`);
  }

  async listRemesaLines(remesaId: string): Promise<RemesaLine[]> {
    const rows = await this.api.get<any[]>(`/remesas/${remesaId}/lines`);
    return rows.map((l): RemesaLine => ({ ...l, amount: Number(l.amount) }));
  }

  // ── Ficheros de devoluciones ──────────────────────────────────────────
  /** Sube un pain.002 o camt.054: queda emparejado y sin contabilizar hasta aplicarlo. */
  async uploadReturnFile(estateId: string, file: File): Promise<ReturnFile> {
    return mapReturnFile(await this.api.uploadFile<any>(`/estates/${estateId}/return-files`, file));
  }

  async listReturnFiles(estateId: string): Promise<ReturnFile[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/return-files`);
    return rows.map(mapReturnFile);
  }

  async getReturnFile(fileId: string): Promise<ReturnFile> {
    return mapReturnFile(await this.api.get<any>(`/return-files/${fileId}`));
  }

  /** Contabiliza las devoluciones emparejadas. Repetirlo no duplica nada. */
  async applyReturnFile(fileId: string): Promise<ReturnFile> {
    return mapReturnFile(await this.api.post<any>(`/return-files/${fileId}/apply`, {}));
  }

  /** El banco abonó la remesa en esa fecha: se contabiliza el cobro de todas sus líneas pendientes. */
  async collectRemesa(remesaId: string, date: string): Promise<void> {
    await this.api.post(`/remesas/${remesaId}/collect`, { date });
  }

  /** Anula una remesa que no llegó a cobrarse: sus recibos quedan libres para otra. */
  async cancelRemesa(remesaId: string): Promise<void> {
    await this.api.post(`/remesas/${remesaId}/cancel`, {});
  }

  /**
   * Devolución (o rechazo previo al cargo) de una línea. Si la remesa ya se
   * cobró, el backend contabiliza la devolución y la comisión.
   */
  async returnRemesaLine(lineId: string, input: {
    returnCode: string; returnReason?: string; date?: string; feeAmount?: number; rechargeFee?: boolean;
  }): Promise<void> {
    await this.api.patch(`/remesa-lines/${lineId}/return`, input);
  }

  // ── Mandates ─────────────────────────────────────────────────────────────
  // TODO(backend): no existe GET /mandates/:id; los mandatos llegan vía
  // GET /properties/:propertyId/mandates.
  async findMandateById(id: string): Promise<Mandate | null> {
    return null;
  }

  async listActiveMandatesForProperty(propertyId: string): Promise<Mandate[]> {
    const all = await this.api.get<any[]>(`/properties/${propertyId}/mandates`, { all: true });
    return all
      .map(m => ({ ...m, signedAt: d(m.signedAt), firstUseAt: m.firstUseAt ? d(m.firstUseAt) : m.firstUseAt, lastUseAt: m.lastUseAt ? d(m.lastUseAt) : m.lastUseAt }))
      .filter(m => m.status === 'active');
  }

  async listMandatesForProperty(propertyId: string): Promise<Mandate[]> {
    const all = await this.api.get<any[]>(`/properties/${propertyId}/mandates`, { all: true });
    return all.map(m => ({ ...m, signedAt: d(m.signedAt), firstUseAt: m.firstUseAt ? d(m.firstUseAt) : m.firstUseAt, lastUseAt: m.lastUseAt ? d(m.lastUseAt) : m.lastUseAt }));
  }

  // TODO(backend): el ciclo de vida del mandato (dormant/expired a 36 meses)
  // se aplica server-side; no hay endpoint de refresco explícito.
  async refreshMandateLifecycle(mandateId: string, _today?: string): Promise<Mandate | null> {
    return null;
  }
}
