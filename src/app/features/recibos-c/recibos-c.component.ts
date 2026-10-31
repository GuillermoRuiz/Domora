import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { AuthService } from '../../core/auth.service';
import { DebtorsService } from '../../core/debtors.service';
import { saveBlob } from '../../core/file-download';
import type { AccountingReceipt } from '../../core/models';
import { OwnerScopeService, type ScopeProperty } from '../../core/owner-scope.service';
import { bindOwnerScopeToRoute } from '../../core/owner-scope-route';
import { ReceiptsService } from '../../core/receipts.service';
import { ReportsService } from '../../core/reports.service';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { TransferInstructionsModalComponent } from '../../shared/components/transfer-instructions-modal/transfer-instructions-modal.component';
import { CommunityScopeSelectorComponent } from '../community-c/community-scope-selector/community-scope-selector.component';

/** Lo que queda por pagar de un recibo; un recibo pagado o anulado no cuenta. */
export function receiptPending(receipt: AccountingReceipt): number {
  if (receipt.status !== 'Pendiente' && receipt.status !== 'Devuelto' && receipt.status !== 'Parcial') return 0;
  return receipt.outstanding ?? receipt.amount;
}

/**
 * «Recibos y pagos» del propietario (rol C): los recibos de la propiedad elegida en la cabecera (o de todas),
 * con el pago por transferencia, el justificante y los informes contables de la propiedad. Un recibo es de una
 * PROPIEDAD: `?propertyId=` elige la propiedad y `?receipt=<id>` resalta ese recibo (enlaces de los avisos). Un recibo
 * antiguo sin propiedad se ve en cualquier ámbito.
 */
@Component({
  selector: 'app-recibos-c',
  standalone: true,
  imports: [TopbarComponent, CommunityScopeSelectorComponent, BadgeComponent, BtnComponent, IconComponent, EmptyStateComponent, TransferInstructionsModalComponent, CurrencyPipe],
  templateUrl: './recibos-c.component.html',
  styleUrl: './recibos-c.component.scss',
})
export class RecibosCComponent {
  readonly scope = inject(OwnerScopeService);
  private state = inject(StateService);
  private auth = inject(AuthService);
  private receiptsSvc = inject(ReceiptsService);
  private reports = inject(ReportsService);
  private debtors = inject(DebtorsService);

  private readonly receipts = signal<AccountingReceipt[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly highlightedId = signal<string | null>(null);
  readonly toastMessage = signal<string | null>(null);

  /** Los recibos del ámbito, del más reciente al más antiguo. */
  readonly rows = computed<AccountingReceipt[]>(() => {
    const selected = this.scope.isAll() ? null : this.scope.selected()?.id ?? null;
    // A receipt without a property (legacy data) belongs to no property in particular: it shows everywhere, as it did
    // in the old receipts tab of the property, so it is never lost nor left out of the pending total.
    return this.receipts()
      .filter((r) => !selected || !r.propertyId || r.propertyId === selected)
      .sort((a, b) => (b.dueDate ?? b.date).localeCompare(a.dueDate ?? a.date));
  });
  readonly pendingTotal = computed(() => this.rows().reduce((sum, r) => sum + receiptPending(r), 0));
  readonly pendingCount = computed(() => this.rows().filter((r) => receiptPending(r) > 0).length);
  readonly scopeName = computed(() => (this.scope.isAll() ? 'Todas mis propiedades' : this.scope.selected()?.nickname ?? ''));

  constructor() {
    bindOwnerScopeToRoute(['propertyId'], (params) => this.highlightedId.set(params.get('receipt')));
    // Again whenever a property is added or removed, like the scope: its receipts come with it.
    effect(() => {
      const userId = this.auth.currentUser()?.id;
      this.state.propertiesVersion();
      if (userId) untracked(() => void this.load(userId));
    });
  }

  private async load(userId: string): Promise<void> {
    this.loading.set(true);
    try {
      this.receipts.set(await this.receiptsSvc.listReceiptsForUser(userId));
      this.failed.set(false);
    } catch (error) {
      console.error('Error cargando los recibos', error);
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** La propiedad de un recibo (para su nombre en «Todas» y el IBAN de su comunidad al pagar). */
  propertyOf(receipt: AccountingReceipt): ScopeProperty | null {
    return this.scope.items().find((p) => p.id === receipt.propertyId) ?? null;
  }

  receiptStatusVariant(status: string): 'green' | 'error' | 'warning' | 'default' {
    if (status === 'Pagada') return 'green';
    if (status === 'Devuelto') return 'error';
    if (status === 'Pendiente' || status === 'Parcial') return 'warning';
    return 'default';
  }

  openAddProperty(): void {
    this.state.showAddPropertyModal.set(true);
  }

  // ── Pago por transferencia ───────────────────────────────────────────
  readonly payTarget = signal<{ amount: number; concept: string; iban: string | null; estateName: string | null } | null>(null);

  openPay(receipt: AccountingReceipt): void {
    const property = this.propertyOf(receipt);
    this.payTarget.set({
      amount: receiptPending(receipt) || receipt.amount,
      concept: `Recibo · ${receipt.period}`,
      iban: property?.estateIban ?? null,
      estateName: property?.estateName ?? null,
    });
  }

  closePay(): void {
    this.payTarget.set(null);
  }

  // ── Justificante de pago ─────────────────────────────────────────────
  private pendingProofReceiptId: string | null = null;
  readonly attachingProofId = signal<string | null>(null);

  triggerAttachProof(receiptId: string, input: HTMLInputElement): void {
    this.pendingProofReceiptId = receiptId;
    input.click();
  }

  async onProofFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const receiptId = this.pendingProofReceiptId;
    input.value = '';
    this.pendingProofReceiptId = null;
    if (!file || !receiptId) return;
    this.attachingProofId.set(receiptId);
    try {
      const updated = await this.receiptsSvc.uploadPaymentProof(receiptId, file);
      this.receipts.update((list) => list.map((r) => (r.id === receiptId ? { ...r, proofFileName: updated.proofFileName } : r)));
      this.showToast('Justificante adjuntado correctamente');
    } catch (error) {
      console.error('Error adjuntando el justificante', error);
      this.showToast('No se pudo adjuntar el justificante');
    } finally {
      this.attachingProofId.set(null);
    }
  }

  async downloadProof(receipt: AccountingReceipt): Promise<void> {
    try {
      await saveBlob(await this.receiptsSvc.downloadPaymentProof(receipt.id), receipt.proofFileName || 'justificante');
    } catch (error) {
      console.error('Error descargando el justificante', error);
      this.showToast('No se pudo descargar el justificante');
    }
  }

  // ── Informes contables de la propiedad elegida ───────────────────────
  readonly downloadingReport = signal<'statement' | 'certificate' | null>(null);

  async downloadStatement(format: 'xlsx' | 'pdf'): Promise<void> {
    const propertyId = this.scope.selected()?.id;
    if (!propertyId || this.scope.isAll()) return;
    this.downloadingReport.set('statement');
    try {
      await saveBlob(await this.reports.downloadPropertyStatement(propertyId, format), `extracto.${format}`);
    } catch (error) {
      console.error('Error descargando el extracto', error);
      this.showToast('No se pudo descargar el extracto');
    } finally {
      this.downloadingReport.set(null);
    }
  }

  /** PDF en borrador (ADR D22): sin firmar, no tiene validez legal como certificado. */
  async downloadDebtCertificate(): Promise<void> {
    const propertyId = this.scope.selected()?.id;
    if (!propertyId || this.scope.isAll()) return;
    this.downloadingReport.set('certificate');
    try {
      await saveBlob(await this.debtors.downloadDebtCertificatePdf(propertyId), 'certificado-deuda.pdf');
    } catch (error) {
      console.error('Error descargando el certificado de deuda', error);
      this.showToast('No se pudo descargar el certificado');
    } finally {
      this.downloadingReport.set(null);
    }
  }

  private showToast(message: string): void {
    this.toastMessage.set(message);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }
}
