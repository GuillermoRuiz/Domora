import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';

// ── Libro diario ────────────────────────────────────────────────────────────

export interface JournalLineView {
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  concept: string | null;
  /** Referencia de la propiedad ('A-101' o 'Esc1-2-B'), si el apunte es de un propietario. */
  property: string | null;
  supplier: string | null;
  costCentre: string | null;
  receiptNo: string | null;
  invoiceNumber: string | null;
}

export interface EntryRef {
  id: string;
  number: number;
  fiscalYear: number;
}

export interface JournalEntryView {
  id: string;
  fiscalYear: number;
  number: number;
  date: string;
  entryType: string;
  sourceType: string;
  /** Origen legible ('Cobro', 'Factura de proveedor'…), lo pone el backend. */
  sourceLabel: string;
  concept: string;
  reference: string | null;
  /** Asiento que este anula, si es un contraasiento. */
  reverses: EntryRef | null;
  /** Contraasiento que lo anula, si se anuló. */
  reversedBy: EntryRef | null;
  /** Solo los asientos manuales y de tesorería se anulan desde el diario. */
  canReverse: boolean;
  attachments: { id: string; fileName: string; mimeType: string; createdAt: string }[];
  total: number;
  lines: JournalLineView[];
}

export interface JournalPage {
  total: number;
  page: number;
  pageSize: number;
  items: JournalEntryView[];
}

export interface JournalQuery {
  from?: string;
  to?: string;
  accountId?: string;
  sourceType?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface ManualLineInput {
  accountId: string;
  debit: number;
  credit: number;
  costCentreId?: string;
  concept?: string;
}

/** Dónde entra o sale el dinero: una cuenta bancaria o, sin ella, la caja. */
export interface QuickEntryInput {
  date: string;
  direction: 'in' | 'out';
  amount: number;
  bankAccountId?: string;
  counterpartAccountId: string;
  costCentreId?: string;
  concept: string;
  reference?: string;
}

export interface TransferInput {
  date: string;
  amount: number;
  fromBankAccountId?: string;
  toBankAccountId?: string;
  concept?: string;
}

function mapEntry(raw: any): JournalEntryView {
  return {
    ...raw,
    date: d(raw.date),
    total: Number(raw.total),
    attachments: raw.attachments ?? [],
    lines: (raw.lines ?? []).map((l: any) => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })),
  };
}

/**
 * Libro diario de una finca (fase 8): consulta, asiento manual, anulación
 * con contraasiento y justificantes; y la tesorería rápida (cobros y pagos
 * sueltos, traspasos), que también son asientos.
 */
@Injectable({ providedIn: 'root' })
export class JournalService {
  private api = inject(ApiClientService);

  async list(estateId: string, query: JournalQuery = {}): Promise<JournalPage> {
    const raw = await this.api.get<any>(`/estates/${estateId}/journal`, {
      from: query.from || undefined,
      to: query.to || undefined,
      accountId: query.accountId || undefined,
      sourceType: query.sourceType || undefined,
      q: query.q?.trim() || undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { ...raw, items: (raw.items ?? []).map(mapEntry) };
  }

  async detail(entryId: string): Promise<JournalEntryView> {
    return mapEntry(await this.api.get<any>(`/journal/${entryId}`));
  }

  async createManual(estateId: string, input: {
    date: string; concept: string; reference?: string; lines: ManualLineInput[];
  }): Promise<JournalEntryView> {
    return mapEntry(await this.api.post<any>(`/estates/${estateId}/journal`, input));
  }

  async reverse(entryId: string, reason: string, date?: string): Promise<void> {
    await this.api.post(`/journal/${entryId}/reverse`, { reason, ...(date ? { date } : {}) });
  }

  async attach(entryId: string, file: File): Promise<void> {
    await this.api.uploadFile(`/journal/${entryId}/attachments`, file);
  }

  downloadAttachment(entryId: string, attachmentId: string): Promise<Blob> {
    return this.api.getBlob(`/journal/${entryId}/attachments/${attachmentId}/file`);
  }

  async quickEntry(estateId: string, input: QuickEntryInput): Promise<void> {
    await this.api.post(`/estates/${estateId}/treasury/entries`, input);
  }

  async transfer(estateId: string, input: TransferInput): Promise<void> {
    await this.api.post(`/estates/${estateId}/treasury/transfers`, input);
  }
}

// ── Conciliación bancaria ───────────────────────────────────────────────────

export interface BankLedgerLine {
  id: string;
  date: string;
  entryId: string;
  entryNumber: number;
  fiscalYear: number;
  sourceType: string;
  concept: string;
  /** Cuentas de contrapartida del asiento ('628 Reparaciones y conservación'). */
  counterparts: string[];
  /** Con signo: + entra dinero, − sale. */
  amount: number;
  balance: number;
  reconciliationGroupId: string | null;
}

export interface BankLedger {
  bankAccountId: string;
  alias: string;
  openingBalance: number;
  closingBalance: number;
  lines: BankLedgerLine[];
}

export interface StatementEntry {
  id: string;
  date: string;
  concept: string;
  /** Con signo, como lo da el banco. */
  amount: number;
  bankRef: string | null;
  reconciliationGroupId: string | null;
  statementId: string | null;
}

export interface BankStatementView {
  entries: StatementEntry[];
  lastStatement: {
    id: string;
    fileName: string;
    periodFrom: string | null;
    periodTo: string | null;
    closingBalance: number;
    importedAt: string;
  } | null;
}

export interface StatementImportResult {
  statementId: string;
  imported: number;
  skippedDuplicates: number;
  openingBalance: number | null;
  closingBalance: number | null;
  warnings: string[];
}

export interface AutoMatchResult {
  matched: number;
  pendingEntries: number;
  pendingLines: number;
}

/** Mayor de cada cuenta bancaria, su extracto y la conciliación entre ambos. */
@Injectable({ providedIn: 'root' })
export class ReconciliationService {
  private api = inject(ApiClientService);

  private base(estateId: string, bankAccountId: string): string {
    return `/estates/${estateId}/bank-accounts/${bankAccountId}`;
  }

  async ledger(estateId: string, bankAccountId: string, range: { from?: string; to?: string } = {}): Promise<BankLedger> {
    const raw = await this.api.get<any>(`${this.base(estateId, bankAccountId)}/ledger`, {
      from: range.from || undefined,
      to: range.to || undefined,
    });
    return {
      ...raw,
      openingBalance: Number(raw.openingBalance),
      closingBalance: Number(raw.closingBalance),
      lines: (raw.lines ?? []).map((l: any) => ({ ...l, date: d(l.date), amount: Number(l.amount), balance: Number(l.balance) })),
    };
  }

  async statement(estateId: string, bankAccountId: string, pending = false): Promise<BankStatementView> {
    const raw = await this.api.get<any>(`${this.base(estateId, bankAccountId)}/statement`, pending ? { pending: true } : undefined);
    return {
      entries: (raw.entries ?? []).map((e: any) => ({ ...e, date: d(e.date), amount: Number(e.amount) })),
      lastStatement: raw.lastStatement
        ? { ...raw.lastStatement, closingBalance: Number(raw.lastStatement.closingBalance) }
        : null,
    };
  }

  /** Norma 43 (.n43/.c43/.943/.txt) o CSV; el backend detecta el formato. */
  importStatement(estateId: string, bankAccountId: string, file: File): Promise<StatementImportResult> {
    return this.api.uploadFile<StatementImportResult>(`${this.base(estateId, bankAccountId)}/statements`, file);
  }

  /** Concilia partidas del extracto con apuntes del banco; los importes deben cuadrar. */
  async match(estateId: string, bankAccountId: string, entryIds: string[], lineIds: string[]): Promise<void> {
    await this.api.post(`${this.base(estateId, bankAccountId)}/reconciliations`, { entryIds, lineIds });
  }

  autoMatch(estateId: string, bankAccountId: string): Promise<AutoMatchResult> {
    return this.api.post<AutoMatchResult>(`${this.base(estateId, bankAccountId)}/reconciliations/auto`, {});
  }

  async unmatch(groupId: string): Promise<void> {
    await this.api.delete(`/reconciliations/${groupId}`);
  }
}
