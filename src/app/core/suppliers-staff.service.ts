import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d, PAY_METHOD_FROM_API, PAY_METHOD_TO_API } from './api-shared';
import type { SupplierPanelOverview, SupplierVisit, SupplierVisitInput } from './supplier-panel.models';
import {
  Supplier, SupplierInvoice, SupplierContract, EstateContract, ContractRenewal, SupplierDocument, SupplierDocumentType, SupplierPerformance,
  StaffMember, StaffDocument, StaffDirectoryEntry, SupplierLedger, SupplierPayment, WithholdingKey,
} from './models';

/** Los importes llegan como número del backend; las fechas, recortadas a AAAA-MM-DD. */
function mapInvoice(i: any): SupplierInvoice {
  return {
    ...i,
    supplierName: i.supplierName ?? i.supplier?.name ?? '',
    issueDate: d(i.issueDate),
    receivedDate: d(i.receivedDate),
    dueDate: i.dueDate ? d(i.dueDate) : null,
    baseAmount: Number(i.baseAmount),
    vatRatePct: Number(i.vatRatePct),
    vatAmount: Number(i.vatAmount),
    withholdingRatePct: Number(i.withholdingRatePct),
    withholdingAmount: Number(i.withholdingAmount),
    total: Number(i.total),
    payable: Number(i.payable),
    outstanding: Number(i.outstanding),
    payableAccount: i.payableAccount ?? (i.payableRole === 'creditors_payable' ? '410' : '400'),
    cancelReason: i.cancelReason ?? null,
    lines: (i.lines ?? []).map((l: any) => ({ ...l, baseAmount: Number(l.baseAmount), amount: Number(l.amount) })),
  };
}

function mapSupplierContract(c: any): SupplierContract {
  return {
    ...c,
    costAmount: c.costAmount == null ? null : Number(c.costAmount),
    startDate: d(c.startDate),
    endDate: c.endDate ? d(c.endDate) : null,
    cancelledAt: c.cancelledAt ? d(c.cancelledAt) : null,
  };
}

function mapSupplierDocument(doc: any): SupplierDocument {
  return { ...doc, expiresAt: doc.expiresAt ? d(doc.expiresAt) : null };
}

/** Proveedores y personal contratado — ambos son "gastos recurrentes de una finca", no se comparten entre fincas de la gestora. */
@Injectable({ providedIn: 'root' })
export class SuppliersStaffService {
  private api = inject(ApiClientService);

  // ── Suppliers ────────────────────────────────────────────────────────────
  async listSuppliers(estateId: string): Promise<Supplier[]> {
    const suppliers = await this.api.get<any[]>(`/estates/${estateId}/suppliers`);
    return suppliers.map((s): Supplier => ({
      ...s,
      lastInvoice: s.lastInvoice ? d(s.lastInvoice) : '',
      lastAmount: Number(s.lastAmount ?? 0),
      ytdSpend: Number(s.ytdSpend ?? 0),
      pendingInvoices: Number(s.pendingInvoices ?? 0),
    }));
  }

  async createSupplier(estateId: string, payload: {
    name: string;
    category: string;
    taxIdCountry?: string;
    taxId?: string;
    vatNumber?: string;
    email?: string;
    phone?: string;
    contactName?: string;
    iban?: string;
    excludedFrom347?: boolean;
  }): Promise<Supplier> {
    const created = await this.api.post<any>(`/estates/${estateId}/suppliers`, payload);
    return {
      ...created,
      lastInvoice: '',
      lastAmount: 0,
      ytdSpend: 0,
      pendingInvoices: 0,
    };
  }

  async listSupplierInvoices(estateId: string, supplierId: string): Promise<SupplierInvoice[]> {
    const invoices = await this.api.get<any[]>(`/estates/${estateId}/suppliers/${supplierId}/invoices`);
    return invoices.map(mapInvoice);
  }

  /** Facturas de proveedores de la finca pendientes de pago (o todas con `all`). */
  async listEstateSupplierInvoices(estateId: string, opts: { all?: boolean } = {}): Promise<SupplierInvoice[]> {
    const invoices = await this.api.get<any[]>(`/estates/${estateId}/supplier-invoices`, { all: opts.all ? 'true' : undefined });
    return invoices.map(mapInvoice);
  }

  /** Registra y contabiliza la factura. Los importes van en euros; el IVA y la retención los calcula el backend. */
  async createSupplierInvoice(estateId: string, supplierId: string, payload: {
    number: string;
    concept: string;
    issueDate: string;
    receivedDate?: string;
    dueDate?: string;
    vatRatePct: number;
    withholdingRatePct: number;
    withholdingKey?: WithholdingKey;
    payableAccount?: '400' | '410';
    lines: { accountId: string; costCentreId?: string; description?: string; baseAmount: number }[];
  }): Promise<SupplierInvoice> {
    return mapInvoice(await this.api.post<any>(`/estates/${estateId}/suppliers/${supplierId}/invoices`, payload));
  }

  /** Anula una factura sin pagos (contraasiento). */
  async cancelSupplierInvoice(estateId: string, supplierId: string, invoiceId: string, reason: string): Promise<SupplierInvoice> {
    return mapInvoice(await this.api.post<any>(`/estates/${estateId}/suppliers/${supplierId}/invoices/${invoiceId}/cancel`, { reason }));
  }

  async paySupplier(estateId: string, payload: {
    supplierId: string; date: string; amount: number; method: string; bankAccountId?: string; invoiceIds?: string[]; notes?: string;
  }): Promise<void> {
    await this.api.post(`/estates/${estateId}/supplier-payments`, {
      ...payload,
      method: PAY_METHOD_TO_API[payload.method] ?? payload.method,
    });
  }

  async listSupplierPayments(estateId: string, supplierId?: string): Promise<SupplierPayment[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/supplier-payments`, { supplierId });
    return rows.map((p): SupplierPayment => ({
      ...p,
      date: d(p.date),
      method: PAY_METHOD_FROM_API[p.method] ?? p.method,
    }));
  }

  async undoSupplierPayment(paymentId: string, reason: string): Promise<void> {
    await this.api.post(`/supplier-payments/${paymentId}/undo`, { reason });
  }

  async supplierLedger(estateId: string, supplierId: string): Promise<SupplierLedger> {
    const ledger = await this.api.get<any>(`/estates/${estateId}/suppliers/${supplierId}/ledger`);
    return { ...ledger, movements: (ledger.movements ?? []).map((m: any) => ({ ...m, date: d(m.date) })) };
  }

  async uploadSupplierInvoiceFile(estateId: string, supplierId: string, invoiceId: string, file: File): Promise<SupplierInvoice> {
    const updated = await this.api.uploadFile<any>(`/estates/${estateId}/suppliers/${supplierId}/invoices/${invoiceId}/file`, file);
    return mapInvoice({ ...updated, supplier: updated.supplier ?? { name: '' }, lines: updated.lines ?? [] });
  }

  downloadSupplierInvoiceFile(estateId: string, supplierId: string, invoiceId: string): Promise<Blob> {
    return this.api.getBlob(`/estates/${estateId}/suppliers/${supplierId}/invoices/${invoiceId}/file`);
  }

  /** Único punto para corregir un dato o dar de baja (status: 'Baja') — antes no existía ningún PATCH de proveedor. */
  async updateSupplier(estateId: string, supplierId: string, patch: Partial<{
    name: string;
    category: string;
    taxIdCountry: string;
    taxId: string;
    vatNumber: string;
    email: string | null;
    phone: string | null;
    /** `null` borra la persona de contacto. */
    contactName: string | null;
    iban: string;
    status: Supplier['status'];
    excludedFrom347: boolean;
  }>): Promise<Supplier> {
    const updated = await this.api.patch<any>(`/estates/${estateId}/suppliers/${supplierId}`, patch);
    return {
      ...updated,
      lastInvoice: updated.lastInvoice ? d(updated.lastInvoice) : '',
      lastAmount: Number(updated.lastAmount ?? 0),
      ytdSpend: Number(updated.ytdSpend ?? 0),
      pendingInvoices: Number(updated.pendingInvoices ?? 0),
    };
  }

  // ── Panel de Proveedores y visitas ───────────────────────────────────────
  /** KPIs, una fila por proveedor (contacto, contrato, próxima visita) y últimas intervenciones. */
  async getSuppliersOverview(estateId: string): Promise<SupplierPanelOverview> {
    return this.api.get<SupplierPanelOverview>(`/estates/${estateId}/suppliers/overview`);
  }

  /** Visitas de un proveedor, las más recientes primero. */
  async listSupplierVisits(estateId: string, supplierId: string): Promise<SupplierVisit[]> {
    return this.api.get<SupplierVisit[]>(`/estates/${estateId}/suppliers/${supplierId}/visits`);
  }

  async createSupplierVisit(estateId: string, supplierId: string, input: SupplierVisitInput): Promise<SupplierVisit> {
    return this.api.post<SupplierVisit>(`/estates/${estateId}/suppliers/${supplierId}/visits`, input);
  }

  /** Solo una visita planificada se puede editar. */
  async updateSupplierVisit(estateId: string, supplierId: string, visitId: string, patch: Partial<SupplierVisitInput>): Promise<SupplierVisit> {
    return this.api.patch<SupplierVisit>(`/estates/${estateId}/suppliers/${supplierId}/visits/${visitId}`, patch);
  }

  /** Marca la visita como realizada; las notas se añaden a las que ya tuviera. */
  async completeSupplierVisit(estateId: string, supplierId: string, visitId: string, notes?: string): Promise<SupplierVisit> {
    return this.api.post<SupplierVisit>(`/estates/${estateId}/suppliers/${supplierId}/visits/${visitId}/complete`, notes ? { notes } : {});
  }

  async cancelSupplierVisit(estateId: string, supplierId: string, visitId: string, notes?: string): Promise<SupplierVisit> {
    return this.api.post<SupplierVisit>(`/estates/${estateId}/suppliers/${supplierId}/visits/${visitId}/cancel`, notes ? { notes } : {});
  }

  /** Solo cambia el vencimiento: el resto de la factura está contabilizado. */
  async updateSupplierInvoiceDueDate(estateId: string, supplierId: string, invoiceId: string, dueDate: string | null): Promise<SupplierInvoice> {
    return mapInvoice(await this.api.patch<any>(`/estates/${estateId}/suppliers/${supplierId}/invoices/${invoiceId}`, { dueDate }));
  }

  // ── Supplier contracts ───────────────────────────────────────────────────
  /** Todos los contratos de la finca (de todos sus proveedores), los más urgentes primero. */
  async listEstateContracts(estateId: string): Promise<EstateContract[]> {
    const contracts = await this.api.get<any[]>(`/estates/${estateId}/contracts`);
    return contracts.map(c => ({
      ...mapSupplierContract(c),
      supplier: c.supplier,
      daysLeft: c.daysLeft,
      annualCost: c.annualCost == null ? null : Number(c.annualCost),
      monthlyCost: c.monthlyCost == null ? null : Number(c.monthlyCost),
      documentCount: c.documentCount ?? 0,
    }));
  }

  /** Últimas renovaciones de los contratos de la finca, la más reciente primero. */
  async listEstateRenewals(estateId: string, limit?: number): Promise<ContractRenewal[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/contracts/renewals`, limit === undefined ? undefined : { limit });
    return rows.map(r => ({
      ...r,
      renewedAt: d(r.renewedAt),
      previousEndDate: r.previousEndDate ? d(r.previousEndDate) : null,
      newEndDate: d(r.newEndDate),
      costAmount: r.costAmount == null ? null : Number(r.costAmount),
      annualCost: r.annualCost == null ? null : Number(r.annualCost),
    }));
  }

  /** Renueva un contrato (nuevo vencimiento; importe y periodicidad opcionales) y deja constancia en el histórico. */
  async renewSupplierContract(estateId: string, supplierId: string, contractId: string, payload: {
    newEndDate: string;
    costAmount?: number | null;
    costFrequency?: SupplierContract['costFrequency'];
    notes?: string;
  }): Promise<SupplierContract> {
    const result = await this.api.post<any>(`/estates/${estateId}/suppliers/${supplierId}/contracts/${contractId}/renew`, payload);
    return mapSupplierContract(result.contract);
  }

  async listSupplierContracts(estateId: string, supplierId: string): Promise<SupplierContract[]> {
    const contracts = await this.api.get<any[]>(`/estates/${estateId}/suppliers/${supplierId}/contracts`);
    return contracts.map(mapSupplierContract);
  }

  async createSupplierContract(estateId: string, supplierId: string, payload: {
    serviceType: string;
    startDate: string;
    endDate?: string;
    renewalType: SupplierContract['renewalType'];
    costAmount?: number | null;
    costFrequency?: SupplierContract['costFrequency'];
    currency?: string;
    reviewFrequency?: string;
    notes?: string;
    contractNumber?: string;
  }): Promise<SupplierContract> {
    const created = await this.api.post<any>(`/estates/${estateId}/suppliers/${supplierId}/contracts`, payload);
    return mapSupplierContract(created);
  }

  async updateSupplierContract(estateId: string, supplierId: string, contractId: string, patch: Partial<{
    serviceType: string;
    startDate: string;
    /** `null` quita la fecha de fin (contrato indefinido). */
    endDate: string | null;
    renewalType: SupplierContract['renewalType'];
    costAmount?: number | null;
    costFrequency?: SupplierContract['costFrequency'];
    currency?: string;
    reviewFrequency: string;
    notes: string;
    /** `null` lo borra. */
    contractNumber: string | null;
  }>): Promise<SupplierContract> {
    const updated = await this.api.patch<any>(`/estates/${estateId}/suppliers/${supplierId}/contracts/${contractId}`, patch);
    return mapSupplierContract(updated);
  }

  async cancelSupplierContract(estateId: string, supplierId: string, contractId: string, cancelledReason?: string): Promise<SupplierContract> {
    const cancelled = await this.api.post<any>(`/estates/${estateId}/suppliers/${supplierId}/contracts/${contractId}/cancel`, { cancelledReason });
    return mapSupplierContract(cancelled);
  }

  // ── Supplier documents ───────────────────────────────────────────────────
  async listSupplierDocuments(estateId: string, supplierId: string): Promise<SupplierDocument[]> {
    const docs = await this.api.get<any[]>(`/estates/${estateId}/suppliers/${supplierId}/documents`);
    return docs.map(mapSupplierDocument);
  }

  async uploadSupplierDocument(estateId: string, supplierId: string, file: File, opts: {
    title: string;
    documentType: SupplierDocumentType;
    expiresAt?: string;
    contractId?: string;
  }): Promise<SupplierDocument> {
    const created = await this.api.uploadFile<any>(`/estates/${estateId}/suppliers/${supplierId}/documents`, file, {
      title: opts.title,
      documentType: opts.documentType,
      expiresAt: opts.expiresAt,
      contractId: opts.contractId,
    });
    return mapSupplierDocument(created);
  }

  downloadSupplierDocument(estateId: string, supplierId: string, docId: string): Promise<Blob> {
    return this.api.getBlob(`/estates/${estateId}/suppliers/${supplierId}/documents/${docId}/file`);
  }

  async deleteSupplierDocument(estateId: string, supplierId: string, docId: string): Promise<void> {
    await this.api.delete(`/estates/${estateId}/suppliers/${supplierId}/documents/${docId}`);
  }

  // ── Desempeño (incidencias asignadas) ────────────────────────────────────
  getSupplierPerformance(estateId: string, supplierId: string): Promise<SupplierPerformance> {
    return this.api.get<SupplierPerformance>(`/estates/${estateId}/suppliers/${supplierId}/performance`);
  }

  // ── Staff (personal contratado) ─────────────────────────────────────────
  async listStaffByEstate(estateId: string): Promise<StaffMember[]> {
    return this.api.get<StaffMember[]>(`/estates/${estateId}/staff`);
  }

  async createStaffMember(estateId: string, payload: {
    fullName: string;
    position: string;
    nationalId?: string;
    email?: string;
    phone?: string;
    contractType: StaffMember['contractType'];
    startDate: string;
    endDate?: string;
    schedule?: string;
    monthlyCost?: number;
  }): Promise<StaffMember> {
    return this.api.post<StaffMember>(`/estates/${estateId}/staff`, payload);
  }

  async updateStaffMember(estateId: string, staffId: string, patch: Partial<{
    fullName: string;
    position: string;
    nationalId: string;
    email: string;
    phone: string;
    contractType: StaffMember['contractType'];
    startDate: string;
    endDate: string;
    schedule: string;
    monthlyCost: number;
    status: StaffMember['status'];
  }>): Promise<StaffMember> {
    return this.api.patch<StaffMember>(`/estates/${estateId}/staff/${staffId}`, patch);
  }

  async listStaffDocuments(estateId: string, staffId: string): Promise<StaffDocument[]> {
    return this.api.get<StaffDocument[]>(`/estates/${estateId}/staff/${staffId}/documents`);
  }

  async uploadStaffDocument(estateId: string, staffId: string, title: string, file: File): Promise<StaffDocument> {
    return this.api.uploadFile<StaffDocument>(`/estates/${estateId}/staff/${staffId}/documents`, file, { title });
  }

  downloadStaffDocument(estateId: string, staffId: string, docId: string): Promise<Blob> {
    return this.api.getBlob(`/estates/${estateId}/staff/${staffId}/documents/${docId}/file`);
  }

  async deleteStaffDocument(estateId: string, staffId: string, docId: string): Promise<void> {
    await this.api.delete(`/estates/${estateId}/staff/${staffId}/documents/${docId}`);
  }

  /** Directorio de solo lectura para el propietario (rol C) — solo personal activo, sin datos de RRHH. */
  async listStaffDirectory(estateId: string): Promise<StaffDirectoryEntry[]> {
    return this.api.get<StaffDirectoryEntry[]>(`/estates/${estateId}/staff/directory`);
  }
}
