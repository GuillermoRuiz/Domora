import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { AccountingReceipt, BankAccount, PropertyAccount } from '../../../../core/models';
import { CollectionsService } from '../../../../core/collections.service';
import { LedgerService } from '../../../../core/ledger.service';

import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
const CASH_METHODS = ['Efectivo', 'Pago en oficina'];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Registrar lo que ha pagado el propietario de un recibo. Por defecto se
 * imputa solo a este recibo y lo que sobre queda como anticipo de la
 * propiedad; sin marcar, el backend lo reparte en orden legal (intereses y
 * lo más antiguo primero). Si la propiedad ya tiene anticipo, se ofrece
 * aplicarlo sin registrar dinero nuevo.
 */
@Component({
  selector: 'app-registrar-cobro',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './registrar-cobro.component.html',
  styleUrls: ['../cobros-modal.scss'],
})
export class RegistrarCobroComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) receipt!: AccountingReceipt;
  @Output() closed = new EventEmitter<{ saved: boolean; message?: string }>();

  private collections = inject(CollectionsService);
  private ledger = inject(LedgerService);

  methods = ['Transferencia', 'Efectivo', 'Pago en oficina', 'Bizum', 'Domiciliación'];
  form = { date: today(), amount: '', method: 'Transferencia', bankAccountId: '', onlyThis: true, notes: '' };

  banks = signal<BankAccount[]>([]);
  account = signal<PropertyAccount | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.form.amount = this.outstanding().toFixed(2).replace('.', ',');
    try {
      const [banks, account] = await Promise.all([
        this.ledger.listBankAccounts(this.estateId),
        this.receipt.propertyId ? this.collections.propertyAccount(this.estateId, this.receipt.propertyId) : Promise.resolve(null),
      ]);
      const open = banks.filter((b) => !b.closedAt);
      this.banks.set(open);
      this.form.bankAccountId = (open.find((b) => b.isDefault) ?? open[0])?.id ?? '';
      this.account.set(account);
    } catch (error) {
      console.error('Error cargando bancos y saldo de la propiedad', error);
    }
  }

  outstanding(): number {
    return this.receipt.outstanding ?? this.receipt.amount;
  }

  isCash(): boolean {
    return CASH_METHODS.includes(this.form.method);
  }

  /** Acepta '1.234,56' (formato español) y '1234.56'. */
  parsedAmount(): number {
    const raw = String(this.form.amount).trim();
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    return Number(normalized);
  }

  /** Lo que excede de este recibo cuando se imputa solo a él: queda como anticipo. */
  excess(): number {
    const amount = this.parsedAmount();
    if (!this.form.onlyThis || !Number.isFinite(amount)) return 0;
    return Math.max(0, Math.round((amount - this.outstanding()) * 100) / 100);
  }

  async save(): Promise<void> {
    const amount = this.parsedAmount();
    if (!Number.isFinite(amount) || amount <= 0) {
      this.error.set('Indica un importe mayor que cero.');
      return;
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
      this.error.set('El importe admite como mucho dos decimales.');
      return;
    }
    if (!this.form.date) {
      this.error.set('Indica la fecha del cobro.');
      return;
    }
    if (!this.receipt.propertyId) {
      this.error.set('El recibo no tiene propiedad asociada.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.collections.registerCollection(this.estateId, {
        propertyId: this.receipt.propertyId,
        date: this.form.date,
        amount,
        method: this.form.method,
        ...(this.isCash() || !this.form.bankAccountId ? {} : { bankAccountId: this.form.bankAccountId }),
        ...(this.form.onlyThis ? { receiptIds: [this.receipt.id] } : {}),
        ...(this.form.notes.trim() ? { notes: this.form.notes.trim() } : {}),
      });
      const excess = this.excess();
      this.closed.emit({
        saved: true,
        message: excess > 0 ? `Cobro registrado. ${this.fmtEur(excess)} quedan como anticipo.` : 'Cobro registrado',
      });
    } catch (error: any) {
      const msg = error?.error?.message;
      this.error.set(typeof msg === 'string' ? msg : 'No se pudo registrar el cobro.');
    } finally {
      this.saving.set(false);
    }
  }

  /** Paga el recibo con el anticipo que ya tiene la propiedad: no entra dinero nuevo. */
  async applyAdvance(): Promise<void> {
    if (!this.receipt.propertyId) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const result = await this.collections.applyAdvance(this.estateId, this.receipt.propertyId, [this.receipt.id]);
      this.closed.emit({ saved: true, message: `Anticipo aplicado: ${this.fmtEur(result.applied)}` });
    } catch (error: any) {
      const msg = error?.error?.message;
      this.error.set(typeof msg === 'string' ? msg : 'No se pudo aplicar el anticipo.');
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.closed.emit({ saved: false });
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
}
