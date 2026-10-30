import { SupplierSpendCardComponent } from './supplier-spend-card/supplier-spend-card.component';
import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, computed, signal, inject, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import {
  Supplier, SupplierInvoice, SupplierContract, SupplierContractStatus, SupplierDocument,
  SupplierDocumentType, SupplierPerformance, SupplierPayment, SupplierLedger, SupplierInvoiceStatus,
} from '../../../core/models';
import { RegistrarFacturaComponent } from '../proveedores/registrar-factura/registrar-factura.component';
import { PagarProveedorComponent } from '../proveedores/pagar-proveedor/pagar-proveedor.component';
import { suggestedReviewFrequency } from '../../../core/contract-hints';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { AiService, type AiInvoiceDocument } from '../../../core/ai.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const CATEGORIES = ['Suministros', 'Limpieza', 'Mantenimiento', 'Seguros', 'Reparaciones', 'Administración', 'Otros'];
const DOCUMENT_TYPES: SupplierDocumentType[] = ['Contrato', 'Seguro', 'Certificado', 'Presupuesto', 'Otro'];

@Component({
  selector: 'app-proveedores-tab',
  standalone: true,
  imports: [PageActionDirective, BadgeComponent, BtnComponent, IconComponent, AvatarComponent, FormsModule, RegistrarFacturaComponent, PagarProveedorComponent, SelectDropdownDirective, SupplierSpendCardComponent],
  templateUrl: './proveedores-tab.component.html',
  styleUrl: './proveedores-tab.component.scss',
})
export class ProveedoresTabComponent implements OnInit, OnDestroy {
  @Input() estateId!: string;

  private dataSvc = inject(SuppliersStaffService);
  suppliers = signal<Supplier[]>([]);
  toastMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.reloadSuppliers(), this.loadInvoiceDocs()]);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
  }

  private async reloadSuppliers(): Promise<void> {
    try {
      this.suppliers.set(await this.dataSvc.listSuppliers(this.estateId));
    } catch (error) {
      console.error('Error cargando proveedores', error);
    }
  }

  // ── Detalle de proveedor ─────────────────────────────────────────────────
  selectedSupplierId = signal<string | null>(null);
  supplierInvoices = signal<SupplierInvoice[]>([]);
  invoicesLoading = signal(false);
  contracts = signal<SupplierContract[]>([]);
  contractsLoading = signal(false);
  documents = signal<SupplierDocument[]>([]);
  documentsLoading = signal(false);
  performance = signal<SupplierPerformance | null>(null);
  payments = signal<SupplierPayment[]>([]);
  ledger = signal<SupplierLedger | null>(null);

  get selectedSupplier(): Supplier | null {
    const id = this.selectedSupplierId();
    return id ? this.suppliers().find(s => s.id === id) ?? null : null;
  }

  readonly currentYear = new Date().getFullYear();

  /** Abre el detalle de un proveedor desde la tarjeta de gasto. */
  openSupplierById(id: string): void {
    const supplier = this.suppliers().find(s => s.id === id);
    if (supplier) void this.openSupplierDetail(supplier);
  }

  async openSupplierDetail(s: Supplier): Promise<void> {
    this.selectedSupplierId.set(s.id);
    this.invoicesLoading.set(true);
    this.contractsLoading.set(true);
    this.documentsLoading.set(true);
    try {
      const [invoices, contracts, documents, performance, payments, ledger] = await Promise.all([
        this.dataSvc.listSupplierInvoices(this.estateId, s.id),
        this.dataSvc.listSupplierContracts(this.estateId, s.id),
        this.dataSvc.listSupplierDocuments(this.estateId, s.id),
        this.dataSvc.getSupplierPerformance(this.estateId, s.id),
        this.dataSvc.listSupplierPayments(this.estateId, s.id),
        this.dataSvc.supplierLedger(this.estateId, s.id),
      ]);
      this.supplierInvoices.set(invoices);
      this.payments.set(payments);
      this.ledger.set(ledger);
      this.contracts.set(contracts);
      this.documents.set(documents);
      this.performance.set(performance);
    } catch (error) {
      console.error('Error cargando el detalle del proveedor', error);
    } finally {
      this.invoicesLoading.set(false);
      this.contractsLoading.set(false);
      this.documentsLoading.set(false);
    }
  }

  closeSupplierDetail(): void {
    this.selectedSupplierId.set(null);
    this.supplierInvoices.set([]);
    this.contracts.set([]);
    this.documents.set([]);
    this.performance.set(null);
    this.payments.set([]);
    this.ledger.set(null);
  }

  /** Recarga facturas, pagos y mayor del proveedor abierto, y la lista de proveedores. */
  private async reloadSupplierMoney(supplierId: string): Promise<void> {
    await this.reloadSuppliers();
    if (this.selectedSupplierId() !== supplierId) return;
    const [invoices, payments, ledger] = await Promise.all([
      this.dataSvc.listSupplierInvoices(this.estateId, supplierId),
      this.dataSvc.listSupplierPayments(this.estateId, supplierId),
      this.dataSvc.supplierLedger(this.estateId, supplierId),
    ]);
    this.supplierInvoices.set(invoices);
    this.payments.set(payments);
    this.ledger.set(ledger);
  }

  // ── Adjunto de factura (siempre privado a gestión) ──────────────────────
  private pendingAttachInvoiceId = signal<string | null>(null);
  attachingInvoiceId = signal<string | null>(null);

  triggerAttach(invoiceId: string, input: HTMLInputElement): void {
    this.pendingAttachInvoiceId.set(invoiceId);
    input.click();
  }

  async onInvoiceFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const invoiceId = this.pendingAttachInvoiceId();
    const supplierId = this.selectedSupplierId();
    input.value = '';
    if (!file || !invoiceId || !supplierId) return;

    this.attachingInvoiceId.set(invoiceId);
    try {
      const updated = await this.dataSvc.uploadSupplierInvoiceFile(this.estateId, supplierId, invoiceId, file);
      this.supplierInvoices.set(this.supplierInvoices().map(i => i.id === invoiceId ? updated : i));
      this.showToast('Fichero adjuntado correctamente');
    } catch (error) {
      console.error('Error adjuntando el fichero', error);
      this.showToast('No se pudo adjuntar el fichero');
    } finally {
      this.attachingInvoiceId.set(null);
      this.pendingAttachInvoiceId.set(null);
    }
  }

  async downloadInvoiceFile(invoice: SupplierInvoice): Promise<void> {
    const supplierId = this.selectedSupplierId();
    if (!supplierId) return;
    try {
      const blob = await this.dataSvc.downloadSupplierInvoiceFile(this.estateId, supplierId, invoice.id);
      this.triggerDownload(blob, invoice.fileName || 'factura');
    } catch (error) {
      console.error('Error descargando el fichero', error);
      this.showToast('No se pudo descargar el fichero');
    }
  }

  invoiceStatusVariant(status: SupplierInvoiceStatus): string {
    if (status === 'Pagada') return 'green';
    if (status === 'Anulada') return 'default';
    return 'warning';
  }

  isOpenInvoice(inv: SupplierInvoice): boolean {
    return inv.status === 'Registrada' || inv.status === 'Parcial';
  }

  /** Para `some(...)` en la plantilla. */
  readonly isOpenInvoiceFn = (inv: SupplierInvoice): boolean => this.isOpenInvoice(inv);

  // ── Pagar ────────────────────────────────────────────────────────────────
  paying = signal<{ invoiceId: string | null } | null>(null);

  openPay(invoice?: SupplierInvoice): void {
    this.paying.set({ invoiceId: invoice?.id ?? null });
  }

  async onPayClosed(result: { saved: boolean; message?: string }): Promise<void> {
    this.paying.set(null);
    const supplierId = this.selectedSupplierId();
    if (!result.saved || !supplierId) return;
    this.showToast(result.message ?? 'Pago registrado');
    await this.reloadSupplierMoney(supplierId);
  }

  // ── Anular factura ───────────────────────────────────────────────────────
  cancellingInvoice = signal<SupplierInvoice | null>(null);
  cancelReason = signal('');
  cancelSaving = signal(false);
  cancelError = signal<string | null>(null);

  openCancelInvoice(inv: SupplierInvoice): void {
    this.cancelReason.set('');
    this.cancelError.set(null);
    this.cancellingInvoice.set(inv);
  }

  async confirmCancelInvoice(): Promise<void> {
    const inv = this.cancellingInvoice();
    const supplierId = this.selectedSupplierId();
    if (!inv || !supplierId) return;
    if (this.cancelReason().trim().length < 3) {
      this.cancelError.set('Indica el motivo (queda en la factura y en la contabilidad).');
      return;
    }
    this.cancelSaving.set(true);
    this.cancelError.set(null);
    try {
      await this.dataSvc.cancelSupplierInvoice(this.estateId, supplierId, inv.id, this.cancelReason().trim());
      this.cancellingInvoice.set(null);
      this.showToast(`Factura ${inv.number} anulada`);
      await this.reloadSupplierMoney(supplierId);
    } catch (error: any) {
      const msg = error?.error?.message;
      this.cancelError.set(typeof msg === 'string' ? msg : 'No se pudo anular la factura');
    } finally {
      this.cancelSaving.set(false);
    }
  }

  // ── Deshacer pago ────────────────────────────────────────────────────────
  undoingPayment = signal<SupplierPayment | null>(null);
  undoReason = signal('');
  undoSaving = signal(false);
  undoError = signal<string | null>(null);

  openUndoPayment(p: SupplierPayment): void {
    this.undoReason.set('');
    this.undoError.set(null);
    this.undoingPayment.set(p);
  }

  async confirmUndoPayment(): Promise<void> {
    const p = this.undoingPayment();
    const supplierId = this.selectedSupplierId();
    if (!p || !supplierId) return;
    if (this.undoReason().trim().length < 3) {
      this.undoError.set('Indica el motivo (queda en la contabilidad).');
      return;
    }
    this.undoSaving.set(true);
    this.undoError.set(null);
    try {
      await this.dataSvc.undoSupplierPayment(p.id, this.undoReason().trim());
      this.undoingPayment.set(null);
      this.showToast('Pago deshecho: las facturas vuelven a estar pendientes');
      await this.reloadSupplierMoney(supplierId);
    } catch (error: any) {
      const msg = error?.error?.message;
      this.undoError.set(typeof msg === 'string' ? msg : 'No se pudo deshacer el pago');
    } finally {
      this.undoSaving.set(false);
    }
  }

  ledgerLabel(sourceType: string, debit: number): string {
    switch (sourceType) {
      case 'supplier_invoice': return debit > 0 ? 'Factura anulada' : 'Factura';
      case 'supplier_payment': return debit > 0 ? 'Pago' : 'Pago deshecho';
      case 'opening_balance': return 'Saldo inicial';
      default: return 'Apunte';
    }
  }

  private triggerDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  categories = computed(() => new Set(this.suppliers().map(s => s.category)).size);
  ytdTotal = computed(() => this.suppliers().reduce((s, x) => s + x.ytdSpend, 0));
  pendingTotal = computed(() => this.suppliers().reduce((s, x) => s + x.pendingInvoices, 0));

  categoryOptions = CATEGORIES;
  documentTypeOptions = DOCUMENT_TYPES;

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  fmtEur0(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ── Nuevo proveedor / editar proveedor (mismo modal, mismo formulario) ──
  showNuevoProveedor = signal(false);
  editingSupplierId = signal<string | null>(null);
  npName = signal('');
  npCategory = signal('');
  npNif = signal('');
  npEmail = signal('');
  npPhone = signal('');
  npIban = signal('');
  npExcluded347 = signal(false);
  /** Se marca a mano: la sugerencia por categoría ya no la pisa. */
  private npExcludedTouched = false;
  npErrors = signal<{ name?: boolean; category?: boolean }>({});
  npSaving = signal(false);
  npError = signal<string | null>(null);

  openNuevoProveedor(): void {
    this.editingSupplierId.set(null);
    this.npName.set('');
    this.npCategory.set('');
    this.npNif.set('');
    this.npEmail.set('');
    this.npPhone.set('');
    this.npIban.set('');
    this.npExcluded347.set(false);
    this.npExcludedTouched = false;
    this.npErrors.set({});
    this.npError.set(null);
    this.showNuevoProveedor.set(true);
  }

  /** Reutiliza el mismo modal/formulario de alta, precargado — antes no existía ninguna forma de corregir un dato ya guardado. */
  openEditSupplier(s: Supplier): void {
    this.editingSupplierId.set(s.id);
    this.npName.set(s.name);
    this.npCategory.set(s.category);
    this.npNif.set(s.taxId ?? '');
    this.npEmail.set(s.email ?? '');
    this.npPhone.set(s.phone ?? '');
    this.npIban.set(s.iban ?? '');
    this.npExcluded347.set(s.excludedFrom347 ?? false);
    this.npExcludedTouched = true;
    this.npErrors.set({});
    this.npError.set(null);
    this.showNuevoProveedor.set(true);
  }

  closeNuevoProveedor(): void {
    this.showNuevoProveedor.set(false);
  }

  /** Suministros y seguros quedan fuera del 347 (art. 33.5 RGAT): se propone al elegir la categoría. */
  onCategoryChange(value: string): void {
    this.npCategory.set(value);
    if (!this.npExcludedTouched) this.npExcluded347.set(['Suministros', 'Seguros'].includes(value.trim()));
  }

  setExcluded347(value: boolean): void {
    this.npExcluded347.set(value);
    this.npExcludedTouched = true;
  }

  async submitNuevoProveedor(): Promise<void> {
    const errors: { name?: boolean; category?: boolean } = {};
    if (!this.npName().trim()) errors.name = true;
    if (!this.npCategory().trim()) errors.category = true;
    this.npErrors.set(errors);
    if (errors.name || errors.category) return;

    this.npSaving.set(true);
    this.npError.set(null);
    const editingId = this.editingSupplierId();
    try {
      if (editingId) {
        const updated = await this.dataSvc.updateSupplier(this.estateId, editingId, {
          name: this.npName().trim(),
          category: this.npCategory().trim(),
          taxId: this.npNif().trim() || undefined,
          email: this.npEmail().trim() || undefined,
          phone: this.npPhone().trim() || undefined,
          iban: this.npIban().trim() || undefined,
          excludedFrom347: this.npExcluded347(),
        });
        this.suppliers.set(this.suppliers().map(s => s.id === updated.id ? updated : s));
        this.showToast('Proveedor actualizado correctamente');
      } else {
        const supplier = await this.dataSvc.createSupplier(this.estateId, {
          name: this.npName().trim(),
          category: this.npCategory().trim(),
          taxId: this.npNif().trim() || undefined,
          email: this.npEmail().trim() || undefined,
          phone: this.npPhone().trim() || undefined,
          iban: this.npIban().trim() || undefined,
          excludedFrom347: this.npExcluded347(),
        });
        this.suppliers.set([supplier, ...this.suppliers()]);
        this.showToast('Proveedor añadido correctamente');
      }
      this.showNuevoProveedor.set(false);
    } catch (error: any) {
      console.error('Error guardando el proveedor', error);
      const msg = error?.error?.message;
      this.npError.set(typeof msg === 'string' ? msg : 'No se pudo guardar el proveedor');
    } finally {
      this.npSaving.set(false);
    }
  }

  /** Baja lógica — nunca se borra un proveedor con facturas/incidencias ya vinculadas. */
  async deactivateSupplier(s: Supplier): Promise<void> {
    if (!confirm(`¿Dar de baja a ${s.name}? Su histórico de facturas se conserva.`)) return;
    try {
      const updated = await this.dataSvc.updateSupplier(this.estateId, s.id, { status: 'Baja' });
      this.suppliers.set(this.suppliers().map(x => x.id === updated.id ? updated : x));
      this.showToast(`${s.name} dado de baja`);
    } catch (error) {
      console.error('Error dando de baja al proveedor', error);
      this.showToast('No se pudo completar la baja');
    }
  }

  // ── Registrar factura (único flujo: subir PDF/imagen o introducirla a mano) ──
  showRegistrarFactura = signal(false);
  rfSupplierId = signal('');

  private aiSvc = inject(AiService);
  private destroyed = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  invoiceDocs = signal<AiInvoiceDocument[]>([]);
  uploadingInvoice = signal(false);
  /** Documento subido que se está revisando en el formulario de registro. */
  reviewingDoc = signal<AiInvoiceDocument | null>(null);
  /** Facturas subidas todavía sin registrar. */
  pendingDocs = computed(() => this.invoiceDocs().filter((d) => !d.invoiceId));

  private static readonly WARNING_LABELS: Record<string, string> = {
    existing_invoice_number_for_supplier: 'Ya existe una factura con ese número para este proveedor.',
    total_does_not_equal_net_plus_vat: 'El total no coincide con base + IVA.',
    currency_missing_or_not_eur: 'La moneda no consta o no es euros.',
    required_fields_missing: 'Faltan datos obligatorios (NIF, número, fecha o total).',
    credit_note_requires_manual_posting: 'Parece una factura rectificativa; hay que contabilizarla a mano.',
    review_withholding_and_payable: 'Tiene retención: revisa lo que se paga al proveedor.',
    ai_unavailable: 'La lectura con IA no está disponible; los datos pueden estar incompletos.',
  };

  warningLabel(code: string): string {
    return ProveedoresTabComponent.WARNING_LABELS[code] ?? code;
  }

  async loadInvoiceDocs(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    try {
      const page = await this.aiSvc.documents(this.estateId);
      this.invoiceDocs.set(page.data);
      // La lectura puede tardar: mientras haya facturas sin leer, se vuelve a consultar.
      if (!this.destroyed && page.data.some((d) => !d.invoiceId && !d.extraction)) {
        this.pollTimer = setTimeout(() => void this.loadInvoiceDocs(), 15000);
      }
    } catch (error) {
      console.error('Error cargando las facturas subidas', error);
    }
  }

  async onInvoiceUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploadingInvoice.set(true);
    try {
      const result = (await this.aiSvc.upload(this.estateId, file)) as { duplicate?: boolean } | null;
      this.showToast(result?.duplicate ? 'Esta factura ya estaba subida' : 'Factura subida. La estamos leyendo…');
      await this.loadInvoiceDocs();
    } catch (error: any) {
      console.error('Error subiendo la factura', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo subir la factura');
    } finally {
      this.uploadingInvoice.set(false);
    }
  }

  async downloadInvoiceDoc(doc: AiInvoiceDocument): Promise<void> {
    try {
      const blob = await this.aiSvc.original(this.estateId, doc.id);
      this.triggerDownload(blob, doc.fileName);
    } catch (error) {
      console.error('Error descargando la factura subida', error);
      this.showToast('No se pudo descargar el original');
    }
  }

  openRegistrarFactura(preselectSupplierId?: string): void {
    this.reviewingDoc.set(null);
    this.rfSupplierId.set(preselectSupplierId ?? '');
    this.showRegistrarFactura.set(true);
  }

  /** Abre el formulario de registro con los datos leídos del documento. */
  reviewInvoiceDoc(doc: AiInvoiceDocument): void {
    if (!doc.extraction) return;
    const norm = (v: string | null | undefined) => (v ?? '').replace(/[\s.-]/g, '').toUpperCase();
    const taxId = norm(doc.extraction.fields.supplier_tax_id);
    const match = taxId ? this.suppliers().find((s) => norm(s.taxId) === taxId) : undefined;
    this.reviewingDoc.set(doc);
    this.rfSupplierId.set(match?.id ?? '');
    this.showRegistrarFactura.set(true);
  }

  reviewNote(doc: AiInvoiceDocument | null): { fileName: string; supplierLabel: string | null; warnings: string[] } | null {
    if (!doc?.extraction) return null;
    const { supplier_name, supplier_tax_id } = doc.extraction.fields;
    const supplierLabel = [supplier_name, supplier_tax_id].filter(Boolean).join(' · ') || null;
    return { fileName: doc.fileName, supplierLabel, warnings: doc.extraction.warnings.map((w) => this.warningLabel(w)) };
  }

  async onFacturaClosed(result: { saved: boolean; supplierId?: string; invoiceId?: string }): Promise<void> {
    const doc = this.reviewingDoc();
    this.showRegistrarFactura.set(false);
    this.reviewingDoc.set(null);
    if (!result.saved || !result.supplierId) return;
    this.showToast('Factura registrada y contabilizada');
    if (doc && result.invoiceId) {
      try {
        await this.aiSvc.link(this.estateId, doc.id, result.invoiceId);
      } catch (error) {
        console.error('Error vinculando el original a la factura', error);
        this.showToast('Factura registrada, pero no se pudo vincular el documento original');
      }
      await this.loadInvoiceDocs();
    }
    await this.reloadSupplierMoney(result.supplierId);
  }

  // ── Contratos ────────────────────────────────────────────────────────────
  showContractModal = signal(false);
  editingContractId = signal<string | null>(null);
  ctServiceType = signal('');
  ctStartDate = signal(this.todayIso());
  ctEndDate = signal('');
  ctRenewalType = signal<SupplierContract['renewalType']>('tacita');
  ctReviewFrequency = signal('');
  ctNotes = signal('');
  ctCostAmount = signal<number | null>(null);
  ctCostFrequency = signal<SupplierContract['costFrequency']>(null);
  ctCurrency = signal('EUR');
  ctSaving = signal(false);
  ctError = signal<string | null>(null);

  openContractModal(contract?: SupplierContract): void {
    this.editingContractId.set(contract?.id ?? null);
    const defaultServiceType = contract?.serviceType ?? this.selectedSupplier?.category ?? '';
    this.ctServiceType.set(defaultServiceType);
    this.ctStartDate.set(contract?.startDate ?? this.todayIso());
    this.ctEndDate.set(contract?.endDate ?? '');
    this.ctRenewalType.set(contract?.renewalType ?? 'tacita');
    this.ctReviewFrequency.set(contract?.reviewFrequency ?? suggestedReviewFrequency(defaultServiceType));
    this.ctNotes.set(contract?.notes ?? '');
    this.ctCostAmount.set(contract?.costAmount ?? null);
    this.ctCostFrequency.set(contract?.costFrequency ?? null);
    this.ctCurrency.set(contract?.currency ?? 'EUR');
    this.ctError.set(null);
    this.showContractModal.set(true);
  }

  closeContractModal(): void {
    this.showContractModal.set(false);
  }

  /** Solo sugiere al crear — al editar, no pisa una cadencia que el admin ya haya ajustado a mano. */
  onContractServiceTypeChange(value: string): void {
    this.ctServiceType.set(value);
    if (!this.editingContractId()) {
      const suggested = suggestedReviewFrequency(value);
      if (suggested) this.ctReviewFrequency.set(suggested);
    }
  }

  contractCostLabel(contract: SupplierContract): string {
    if (contract.costAmount == null) return 'Coste no informado';
    const amount = new Intl.NumberFormat('es-ES', { style: 'currency', currency: contract.currency ?? 'EUR' }).format(contract.costAmount);
    const frequency = { MONTHLY: 'mensual', QUARTERLY: 'trimestral', SEMIANNUAL: 'semestral', ANNUAL: 'anual', ONE_OFF: 'pago ?nico', OTHER: 'otra frecuencia' };
    return `${amount} ? ${contract.costFrequency ? frequency[contract.costFrequency] : 'frecuencia sin informar'}`;
  }

  contractStatusVariant(status: SupplierContractStatus): string {
    if (status === 'Activo') return 'green';
    if (status === 'PorVencer') return 'warning';
    if (status === 'Vencido') return 'error';
    return 'default';
  }

  async submitContract(): Promise<void> {
    const supplierId = this.selectedSupplierId();
    if (!supplierId || !this.ctServiceType().trim() || !this.ctStartDate()) {
      this.ctError.set('Indica al menos el tipo de servicio y la fecha de inicio.');
      return;
    }
    const amount = this.ctCostAmount();
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      this.ctError.set('El coste debe ser un importe mayor o igual a cero.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(this.ctCurrency())) {
      this.ctError.set('Indica una moneda ISO de tres letras (por ejemplo EUR).');
      return;
    }
    this.ctSaving.set(true);
    this.ctError.set(null);
    const payload = {
      serviceType: this.ctServiceType().trim(),
      startDate: this.ctStartDate(),
      endDate: this.ctEndDate() || undefined,
      renewalType: this.ctRenewalType(),
      costAmount: this.ctCostAmount(),
      costFrequency: this.ctCostFrequency(),
      currency: this.ctCurrency(),
      reviewFrequency: this.ctReviewFrequency().trim() || undefined,
      notes: this.ctNotes().trim() || undefined,
    };
    const editingId = this.editingContractId();
    try {
      const saved = editingId
        ? await this.dataSvc.updateSupplierContract(this.estateId, supplierId, editingId, payload)
        : await this.dataSvc.createSupplierContract(this.estateId, supplierId, payload);
      this.contracts.set(
        editingId ? this.contracts().map(c => c.id === saved.id ? saved : c) : [saved, ...this.contracts()],
      );
      await this.reloadSuppliers();
      this.showContractModal.set(false);
      this.showToast(editingId ? 'Contrato actualizado' : 'Contrato creado');
    } catch (error: any) {
      console.error('Error guardando el contrato', error);
      const msg = error?.error?.message;
      this.ctError.set(typeof msg === 'string' ? msg : 'No se pudo guardar el contrato');
    } finally {
      this.ctSaving.set(false);
    }
  }

  async cancelContract(contract: SupplierContract): Promise<void> {
    if (!confirm(`¿Cancelar el contrato "${contract.serviceType}"?`)) return;
    const supplierId = this.selectedSupplierId();
    if (!supplierId) return;
    try {
      const cancelled = await this.dataSvc.cancelSupplierContract(this.estateId, supplierId, contract.id);
      this.contracts.set(this.contracts().map(c => c.id === cancelled.id ? cancelled : c));
      await this.reloadSuppliers();
      this.showToast('Contrato cancelado');
    } catch (error) {
      console.error('Error cancelando el contrato', error);
      this.showToast('No se pudo cancelar el contrato');
    }
  }

  // ── Documentos ───────────────────────────────────────────────────────────
  showDocumentModal = signal(false);
  docTitle = signal('');
  docType = signal<SupplierDocumentType>('Contrato');
  docExpiresAt = signal('');
  docContractId = signal('');
  docFile = signal<File | null>(null);
  docSaving = signal(false);
  docError = signal<string | null>(null);

  openDocumentModal(): void {
    this.docTitle.set('');
    this.docType.set('Contrato');
    this.docExpiresAt.set('');
    this.docContractId.set('');
    this.docFile.set(null);
    this.docError.set(null);
    this.showDocumentModal.set(true);
  }

  closeDocumentModal(): void {
    this.showDocumentModal.set(false);
  }

  onDocumentFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.docFile.set(input.files?.[0] ?? null);
  }

  async submitDocument(): Promise<void> {
    const supplierId = this.selectedSupplierId();
    const file = this.docFile();
    if (!supplierId || !file) {
      this.docError.set('Selecciona un fichero.');
      return;
    }
    this.docSaving.set(true);
    this.docError.set(null);
    try {
      const created = await this.dataSvc.uploadSupplierDocument(this.estateId, supplierId, file, {
        title: this.docTitle().trim() || file.name,
        documentType: this.docType(),
        expiresAt: this.docExpiresAt() || undefined,
        contractId: this.docContractId() || undefined,
      });
      this.documents.set([created, ...this.documents()]);
      await this.reloadSuppliers();
      this.showDocumentModal.set(false);
      this.showToast('Documento subido correctamente');
    } catch (error: any) {
      console.error('Error subiendo el documento', error);
      const msg = error?.error?.message;
      this.docError.set(typeof msg === 'string' ? msg : 'No se pudo subir el documento');
    } finally {
      this.docSaving.set(false);
    }
  }

  async downloadDocument(doc: SupplierDocument): Promise<void> {
    const supplierId = this.selectedSupplierId();
    if (!supplierId) return;
    try {
      const blob = await this.dataSvc.downloadSupplierDocument(this.estateId, supplierId, doc.id);
      this.triggerDownload(blob, doc.fileName);
    } catch (error) {
      console.error('Error descargando el documento', error);
      this.showToast('No se pudo descargar el documento');
    }
  }

  async deleteDocument(doc: SupplierDocument): Promise<void> {
    if (!confirm(`¿Eliminar "${doc.title}"?`)) return;
    const supplierId = this.selectedSupplierId();
    if (!supplierId) return;
    try {
      await this.dataSvc.deleteSupplierDocument(this.estateId, supplierId, doc.id);
      this.documents.set(this.documents().filter(d => d.id !== doc.id));
      await this.reloadSuppliers();
      this.showToast('Documento eliminado');
    } catch (error) {
      console.error('Error eliminando el documento', error);
      this.showToast('No se pudo eliminar el documento');
    }
  }
}
