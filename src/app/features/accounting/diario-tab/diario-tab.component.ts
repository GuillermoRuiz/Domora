import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ChartAccount, CostCentre } from '../../../core/models';
import { AccountingService } from '../../../core/accounting.service';
import { CostCentresService } from '../../../core/cost-centres.service';
import { JournalEntryView, JournalService } from '../../../core/journal.service';
import { AsientoManualDialogComponent } from './asiento-manual-dialog.component';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
/** Orígenes por los que se puede filtrar (los nombres son los mismos que pone el backend en `sourceLabel`). */
export const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'manual', label: 'Asiento manual' },
  { value: 'treasury', label: 'Tesorería' },
  { value: 'receipt_issue', label: 'Emisión de recibo' },
  { value: 'receipt_cancel', label: 'Anulación de recibo' },
  { value: 'collection', label: 'Cobro' },
  { value: 'remesa_collection', label: 'Cobro de remesa' },
  { value: 'receipt_return', label: 'Devolución' },
  { value: 'advance_application', label: 'Aplicación de anticipo' },
  { value: 'suspense_application', label: 'Ingreso identificado' },
  { value: 'supplier_invoice', label: 'Factura de proveedor' },
  { value: 'supplier_payment', label: 'Pago a proveedor' },
  { value: 'tax_settlement', label: 'Impuestos y Seguridad Social' },
  { value: 'payroll', label: 'Nómina' },
  { value: 'opening_balance', label: 'Apertura' },
  { value: 'import', label: 'Importación' },
];

const PAGE_SIZE = 50;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/**
 * Libro diario de la finca (fase 8): todos los asientos, numerados por
 * ejercicio y en orden de registro. Aquí se consultan, se registran
 * asientos manuales, se anulan con contraasiento los manuales y de
 * tesorería, y se adjuntan justificantes.
 */
@Component({
  selector: 'app-diario-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BadgeComponent, BtnComponent, IconComponent, AsientoManualDialogComponent, SelectDropdownDirective],
  templateUrl: './diario-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', './diario-tab.component.scss'],
})
export class DiarioTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private journal = inject(JournalService);
  private accounting = inject(AccountingService);
  private costCentresSvc = inject(CostCentresService);

  readonly sourceOptions = SOURCE_OPTIONS;

  entries = signal<JournalEntryView[]>([]);
  total = signal(0);
  page = signal(1);
  loading = signal(true);
  accounts = signal<ChartAccount[]>([]);
  costCentres = signal<CostCentre[]>([]);
  expandedId = signal<string | null>(null);
  toastMessage = signal<string | null>(null);

  filters = { from: '', to: '', sourceType: '', accountId: '', q: '' };

  pages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  /** Cuentas que admiten apuntes, para filtrar el diario por cuenta. */
  filterAccounts = computed(() => this.accounts().filter((a) => a.postable !== false).sort((a, b) => a.code.localeCompare(b.code)));

  async ngOnInit(): Promise<void> {
    try {
      const [accounts, costCentres] = await Promise.all([
        this.accounting.listChartAccounts(this.estateId),
        this.costCentresSvc.listCostCentres(this.estateId),
        this.load(),
      ]);
      this.accounts.set(accounts);
      this.costCentres.set(costCentres.filter((c) => c.status === 'Activo'));
    } catch (error) {
      console.error('Error cargando el diario', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async load(): Promise<void> {
    const res = await this.journal.list(this.estateId, { ...this.filters, page: this.page(), pageSize: PAGE_SIZE });
    this.entries.set(res.items);
    this.total.set(res.total);
  }

  async search(): Promise<void> {
    this.page.set(1);
    this.expandedId.set(null);
    await this.load();
  }

  async clearFilters(): Promise<void> {
    this.filters = { from: '', to: '', sourceType: '', accountId: '', q: '' };
    await this.search();
  }

  async goTo(page: number): Promise<void> {
    if (page < 1 || page > this.pages()) return;
    this.page.set(page);
    this.expandedId.set(null);
    await this.load();
  }

  toggle(id: string): void {
    this.expandedId.update((cur) => (cur === id ? null : id));
  }

  // ── Asiento manual ──────────────────────────────────────────────────────
  showManual = signal(false);

  async onManualSaved(entry: JournalEntryView): Promise<void> {
    this.showManual.set(false);
    this.showToast(`Asiento ${entry.fiscalYear}/${entry.number} registrado`);
    await this.search();
  }

  // ── Anular (contraasiento) ─────────────────────────────────────────────
  reversing = signal<JournalEntryView | null>(null);
  reverseForm = { reason: '', date: today() };
  reverseSaving = signal(false);
  reverseError = signal<string | null>(null);

  openReverse(entry: JournalEntryView): void {
    this.reverseForm = { reason: '', date: today() };
    this.reverseError.set(null);
    this.reversing.set(entry);
  }

  async confirmReverse(): Promise<void> {
    const entry = this.reversing();
    if (!entry) return;
    const reason = this.reverseForm.reason.trim();
    if (reason.length < 3) return this.reverseError.set('Indica el motivo (queda en el contraasiento).');
    this.reverseSaving.set(true);
    this.reverseError.set(null);
    try {
      await this.journal.reverse(entry.id, reason, this.reverseForm.date || undefined);
      this.reversing.set(null);
      this.showToast(`Asiento ${entry.fiscalYear}/${entry.number} anulado`);
      await this.load();
    } catch (error) {
      this.reverseError.set(apiMessage(error, 'No se pudo anular el asiento.'));
    } finally {
      this.reverseSaving.set(false);
    }
  }

  // ── Justificantes ───────────────────────────────────────────────────────
  uploadingId = signal<string | null>(null);

  async onAttachmentFile(entry: JournalEntryView, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploadingId.set(entry.id);
    try {
      await this.journal.attach(entry.id, file);
      const fresh = await this.journal.detail(entry.id);
      this.entries.update((list) => list.map((e) => (e.id === fresh.id ? fresh : e)));
      this.showToast('Justificante adjuntado');
    } catch (error) {
      this.showToast(apiMessage(error, 'No se pudo adjuntar el fichero.'));
    } finally {
      this.uploadingId.set(null);
    }
  }

  async downloadAttachment(entry: JournalEntryView, attachment: { id: string; fileName: string }): Promise<void> {
    try {
      const blob = await this.journal.downloadAttachment(entry.id, attachment.id);
      this.triggerDownload(blob, attachment.fileName);
    } catch {
      this.showToast('No se pudo descargar el justificante.');
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

  /** Detalle de la línea: propiedad, proveedor, recibo, factura y centro de coste que la acompañan. */
  lineDimensions(l: JournalEntryView['lines'][number]): string {
    return [
      l.property && `Propiedad ${l.property}`,
      l.receiptNo && `Recibo ${l.receiptNo}`,
      l.supplier,
      l.invoiceNumber && `Factura ${l.invoiceNumber}`,
      l.costCentre && `Centro ${l.costCentre}`,
    ].filter(Boolean).join(' · ');
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 3000);
  }
}
