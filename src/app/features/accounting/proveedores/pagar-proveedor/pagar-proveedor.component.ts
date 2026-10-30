import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BankAccount, SupplierInvoice } from '../../../../core/models';
import { LedgerService } from '../../../../core/ledger.service';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';

import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function toCents(value: string): number {
  const raw = String(value ?? '').trim();
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  if (!raw || !Number.isFinite(n)) return NaN;
  const cents = Math.round(n * 100);
  return Math.abs(cents - n * 100) > 1e-6 ? NaN : cents;
}

/**
 * Pagar facturas de un proveedor. Se eligen las facturas y el importe (se
 * puede pagar una parte); el pago sale del banco o de la caja y deja las
 * facturas pagadas o a medias. A un proveedor no se le paga de más.
 */
@Component({
  selector: 'app-pagar-proveedor',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './pagar-proveedor.component.html',
  styleUrls: ['../../cobros/cobros-modal.scss', './pagar-proveedor.component.scss'],
})
export class PagarProveedorComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) supplierId!: string;
  @Input() supplierName = '';
  /** Facturas del proveedor; solo se ofrecen las pendientes. */
  @Input() invoices: SupplierInvoice[] = [];
  /** Factura a pagar; sin ella, se marcan todas las pendientes. */
  @Input() invoiceId: string | null = null;
  @Output() closed = new EventEmitter<{ saved: boolean; message?: string }>();

  private ledger = inject(LedgerService);
  private suppliersSvc = inject(SuppliersStaffService);

  methods = ['Transferencia', 'Domiciliación', 'Efectivo'];
  banks = signal<BankAccount[]>([]);
  selected = signal<Set<string>>(new Set());
  amount = signal('');
  form = { date: today(), method: 'Transferencia', bankAccountId: '', notes: '' };
  saving = signal(false);
  error = signal<string | null>(null);

  open = computed(() =>
    this.invoices
      .filter((i) => i.status === 'Registrada' || i.status === 'Parcial')
      .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.issueDate.localeCompare(b.issueDate)),
  );

  selectedPending = computed(() =>
    this.open().filter((i) => this.selected().has(i.id)).reduce((s, i) => s + Math.round(i.outstanding * 100), 0) / 100,
  );

  async ngOnInit(): Promise<void> {
    const initial = this.invoiceId ? [this.invoiceId] : this.open().map((i) => i.id);
    this.selected.set(new Set(initial));
    this.amount.set(this.selectedPending().toFixed(2).replace('.', ','));
    try {
      const banks = (await this.ledger.listBankAccounts(this.estateId)).filter((b) => !b.closedAt);
      this.banks.set(banks);
      this.form.bankAccountId = (banks.find((b) => b.isDefault) ?? banks[0])?.id ?? '';
    } catch (error) {
      console.error('Error cargando cuentas bancarias', error);
    }
  }

  toggle(invoiceId: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(invoiceId);
    else next.delete(invoiceId);
    this.selected.set(next);
    this.amount.set(this.selectedPending().toFixed(2).replace('.', ','));
  }

  isCash(): boolean {
    return this.form.method === 'Efectivo';
  }

  async save(): Promise<void> {
    const cents = toCents(this.amount());
    const ids = this.open().filter((i) => this.selected().has(i.id)).map((i) => i.id);
    if (ids.length === 0) return this.error.set('Elige al menos una factura.');
    if (!Number.isFinite(cents) || cents <= 0) return this.error.set('Indica un importe mayor que cero, con dos decimales como mucho.');
    if (cents > Math.round(this.selectedPending() * 100)) {
      return this.error.set(`El pago supera lo pendiente de esas facturas (${this.fmtEur(this.selectedPending())}).`);
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.suppliersSvc.paySupplier(this.estateId, {
        supplierId: this.supplierId,
        date: this.form.date,
        amount: cents / 100,
        method: this.form.method,
        ...(this.isCash() || !this.form.bankAccountId ? {} : { bankAccountId: this.form.bankAccountId }),
        invoiceIds: ids,
        ...(this.form.notes.trim() ? { notes: this.form.notes.trim() } : {}),
      });
      this.closed.emit({ saved: true, message: `Pago de ${this.fmtEur(cents / 100)} registrado` });
    } catch (error: any) {
      const msg = error?.error?.message;
      this.error.set(Array.isArray(msg) ? msg.join(' ') : typeof msg === 'string' ? msg : 'No se pudo registrar el pago.');
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
