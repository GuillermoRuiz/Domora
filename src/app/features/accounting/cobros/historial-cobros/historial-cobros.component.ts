import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { ReceiptHistory, ReceiptMovement, SEPA_RETURN_CODES } from '../../../../core/models';
import { CollectionsService } from '../../../../core/collections.service';

import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
const CASH_METHODS = ['Efectivo', 'Pago en oficina'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Qué le ha pasado al recibo, movimiento a movimiento, con lo que debe tras
 * cada uno. Desde aquí se deshace un cobro registrado por error o se
 * registra que el banco lo devolvió. Los cobros de remesa se devuelven desde
 * la propia remesa.
 */
@Component({
  selector: 'app-historial-cobros',
  standalone: true,
  imports: [FormsModule, BtnComponent, SelectDropdownDirective],
  templateUrl: './historial-cobros.component.html',
  styleUrls: ['../cobros-modal.scss', './historial-cobros.component.scss'],
})
export class HistorialCobrosComponent implements OnChanges {
  @Input({ required: true }) receiptId!: string;
  /** El propietario (rol C) solo consulta. */
  @Input() readonly = false;
  @Output() changed = new EventEmitter<string>();

  private collections = inject(CollectionsService);

  history = signal<ReceiptHistory | null>(null);
  loadError = signal<string | null>(null);

  undoing = signal<ReceiptMovement | null>(null);
  undoReason = '';
  returning = signal<ReceiptMovement | null>(null);
  returnForm = { date: today(), returnCode: 'AM04', returnReason: '', feeAmount: '', rechargeFee: false };
  returnCodes = SEPA_RETURN_CODES;
  saving = signal(false);
  actionError = signal<string | null>(null);

  async ngOnChanges(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loadError.set(null);
    try {
      this.history.set(await this.collections.receiptHistory(this.receiptId));
    } catch (error) {
      console.error('Error cargando el historial del recibo', error);
      this.loadError.set('No se pudo cargar el historial de cobros.');
    }
  }

  label(m: ReceiptMovement): string {
    switch (m.sourceType) {
      case 'receipt_issue': return m.debit > 0 ? 'Emisión' : 'Anulación del recibo';
      case 'collection': return m.credit > 0 ? 'Cobro' : 'Cobro deshecho';
      case 'remesa_collection': return m.credit > 0 ? 'Cobro por remesa' : 'Cobro por remesa deshecho';
      case 'receipt_return': return m.debit > 0 ? 'Devolución del banco' : 'Devolución anulada';
      case 'advance_application': return m.credit > 0 ? 'Anticipo aplicado' : 'Aplicación de anticipo deshecha';
      case 'suspense_application': return m.credit > 0 ? 'Ingreso identificado' : 'Ingreso identificado deshecho';
      case 'interest_accrual': return 'Intereses de demora';
      case 'opening_balance': return 'Saldo inicial';
      case 'import': return 'Importación';
      default: return m.concept;
    }
  }

  canUndo(m: ReceiptMovement): boolean {
    return !this.readonly && m.collectionActive && !m.fromRemesa;
  }

  canReturn(m: ReceiptMovement): boolean {
    return !this.readonly && m.collectionActive && !m.fromRemesa && !CASH_METHODS.includes(m.method ?? '');
  }

  openUndo(m: ReceiptMovement): void {
    this.undoReason = '';
    this.actionError.set(null);
    this.undoing.set(m);
  }

  async confirmUndo(): Promise<void> {
    const m = this.undoing();
    if (!m?.collectionId) return;
    if (this.undoReason.trim().length < 3) {
      this.actionError.set('Indica el motivo (queda en la contabilidad).');
      return;
    }
    await this.run(async () => {
      await this.collections.undoCollection(m.collectionId!, this.undoReason.trim());
      this.undoing.set(null);
      this.changed.emit('Cobro deshecho: el recibo vuelve a deber ese importe');
    });
  }

  openReturn(m: ReceiptMovement): void {
    this.returnForm = { date: today(), returnCode: 'AM04', returnReason: '', feeAmount: '', rechargeFee: false };
    this.actionError.set(null);
    this.returning.set(m);
  }

  async confirmReturn(): Promise<void> {
    const m = this.returning();
    if (!m?.collectionId) return;
    const rawFee = String(this.returnForm.feeAmount).trim().replace(',', '.');
    const fee = rawFee === '' ? 0 : Number(rawFee);
    if (!Number.isFinite(fee) || fee < 0) {
      this.actionError.set('La comisión no es un importe válido.');
      return;
    }
    const label = this.returnCodes.find((c) => c.code === this.returnForm.returnCode)?.label;
    await this.run(async () => {
      await this.collections.returnCollection(m.collectionId!, {
        date: this.returnForm.date,
        returnCode: this.returnForm.returnCode,
        returnReason: this.returnForm.returnReason.trim() || label,
        ...(fee > 0 ? { feeAmount: fee, rechargeFee: this.returnForm.rechargeFee } : {}),
      });
      this.returning.set(null);
      this.changed.emit('Devolución registrada: el recibo vuelve a deber ese importe');
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.actionError.set(null);
    try {
      await fn();
      await this.load();
    } catch (error: any) {
      const msg = error?.error?.message;
      this.actionError.set(typeof msg === 'string' ? msg : 'No se pudo completar la operación.');
    } finally {
      this.saving.set(false);
    }
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
}
