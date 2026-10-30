import { Injectable, inject } from "@angular/core";
import { ApiClientService } from "./api-client.service";
export interface AiIntelligenceItem {
  signal_id: string;
  priority: "high" | "medium" | "low";
  title: string;
  explanation: string;
  recommended_action: string;
  entity_type: string;
  entity_id: string;
  link: string;
}
export interface AiIntelligenceView {
  latest: {
    id: string;
    weekKey: string;
    snapshotAt: string;
    completedAt: string;
    summary: string;
    items: AiIntelligenceItem[];
  } | null;
  processing: { status: string; weekKey: string; snapshotAt: string } | null;
}
export interface InvoiceFields {
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  description: string | null;
  net_amount: string | null;
  vat_amount: string | null;
  total_amount: string | null;
  withholding_amount: string | null;
  currency: string | null;
  payment_reference: string | null;
  needs_review: boolean;
}
export interface AiInvoiceDocument {
  id: string;
  fileName: string;
  status: string;
  invoiceId: string | null;
  extraction: {
    fields: InvoiceFields;
    warnings: string[];
    source: string;
  } | null;
  createdAt: string;
}
export interface AiPage<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ReconciliationSuggestion {
  id: string;
  status: string;
  entryIds: string[];
  lineIds: string[];
  invoiceIds: string[];
  bankAccountId: string;
  evidence: {
    score: number;
    tier: string;
    evidence: {
      exactReference: boolean;
      supplierName: boolean;
      maxDateDays: number;
      competingCandidates: number;
    };
  };
  aiReview: { evidence_summary: string } | null;
  entries: { id: string; date: string; concept: string; amount: string }[];
  lines: {
    id: string;
    date: string;
    concept: string | null;
    debit: string;
    credit: string;
  }[];
  invoices: {
    id: string;
    number: string;
    concept: string;
    payable: string;
    status: string;
    supplier: { name: string };
  }[];
}
export interface AiReconciliationView extends AiPage<ReconciliationSuggestion> {
  counts: {
    bankMovements: number;
    automaticallyReconciled: number;
    manuallyReconciled: number;
    suggested: number;
    unmatched: number;
  };
}
@Injectable({ providedIn: "root" })
export class AiService {
  private readonly api = inject(ApiClientService);
  private path(estateId: string, suffix: string) {
    return `/estates/${encodeURIComponent(estateId)}/ai/${suffix}`;
  }
  intelligence(estateId: string) {
    return this.api.get<AiIntelligenceView>(
      this.path(estateId, "intelligence"),
    );
  }
  documents(estateId: string, page = 1) {
    return this.api.get<AiPage<AiInvoiceDocument>>(
      this.path(estateId, "invoices/documents"),
      { page },
    );
  }
  upload(estateId: string, file: File) {
    return this.api.uploadFile(this.path(estateId, "invoices/documents"), file);
  }
  original(estateId: string, id: string) {
    return this.api.getBlob(
      this.path(
        estateId,
        `invoices/documents/${encodeURIComponent(id)}/original`,
      ),
    );
  }
  link(estateId: string, id: string, invoiceId: string) {
    return this.api.post(
      this.path(
        estateId,
        `invoices/documents/${encodeURIComponent(id)}/invoice-link`,
      ),
      { invoiceId },
    );
  }
  reconciliation(estateId: string, page = 1) {
    return this.api.get<AiReconciliationView>(
      this.path(estateId, "reconciliation"),
      { page },
    );
  }
  accept(estateId: string, id: string) {
    return this.api.post(
      this.path(
        estateId,
        `reconciliation/${encodeURIComponent(id)}/acceptance`,
      ),
      {},
    );
  }
  reject(estateId: string, id: string) {
    return this.api.post(
      this.path(estateId, `reconciliation/${encodeURIComponent(id)}/rejection`),
      {},
    );
  }
  run(estateId: string, id: string) {
    return this.api.post(
      this.path(
        estateId,
        `banks/${encodeURIComponent(id)}/reconciliation-runs`,
      ),
      {},
    );
  }
}
