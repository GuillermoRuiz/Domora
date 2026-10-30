import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BankAccount, OwnerProperty, SuspenseItem } from '../../../../core/models';
import { CollectionsService } from '../../../../core/collections.service';
import { LedgerService } from '../../../../core/ledger.service';

import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Acepta '1.234,56' y '1234.56'. */
function parseEuros(value: string): number {
  const raw = String(value).trim();
  return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
}

/**
 * Dinero que ha entrado en el banco sin saber de quién es (cuenta 555):
 * se registra en cuanto aparece en el extracto, para que el banco cuadre, y
 * se aplica a una propiedad cuando se identifica. Al aplicarlo cuenta como
 * un cobro de esa propiedad.
 */
@Component({
  selector: 'app-ingresos-sin-identificar',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './ingresos-sin-identificar.component.html',
  styleUrls: ['../cobros-modal.scss', './ingresos-sin-identificar.component.scss'],
})
export class IngresosSinIdentificarComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input() properties: OwnerProperty[] = [];
  @Output() closed = new EventEmitter<{ changed: boolean }>();

  private collections = inject(CollectionsService);
  private ledger = inject(LedgerService);

  items = signal<SuspenseItem[]>([]);
  banks = signal<BankAccount[]>([]);
  loading = signal(true);
  saving = signal(false);
  error = signal<string | null>(null);
  private changed = false;

  pendingTotal = computed(() => this.items().reduce((s, i) => s + i.remaining, 0));

  showNew = signal(false);
  newForm = { date: today(), amount: '', concept: '', bankAccountId: '' };

  applying = signal<SuspenseItem | null>(null);
  applyForm = { propertyId: '', amount: '', date: today() };

  async ngOnInit(): Promise<void> {
    try {
      const [items, banks] = await Promise.all([
        this.collections.listSuspense(this.estateId),
        this.ledger.listBankAccounts(this.estateId),
      ]);
      this.items.set(items);
      const open = banks.filter((b) => !b.closedAt);
      this.banks.set(open);
      this.newForm.bankAccountId = (open.find((b) => b.isDefault) ?? open[0])?.id ?? '';
    } catch (error) {
      console.error('Error cargando ingresos sin identificar', error);
      this.error.set('No se pudieron cargar los ingresos sin identificar.');
    } finally {
      this.loading.set(false);
    }
  }

  propertyLabel(p: OwnerProperty): string {
    return p.ref ?? ([p.staircase, p.floor, p.door].filter(Boolean).join('-') || p.type);
  }

  propertyName(id: string): string {
    const p = this.properties.find((x) => x.id === id);
    return p ? this.propertyLabel(p) : '—';
  }

  async register(): Promise<void> {
    const amount = parseEuros(this.newForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.error.set('Indica un importe mayor que cero.');
      return;
    }
    if (!this.newForm.concept.trim()) {
      this.error.set('Indica el concepto que aparece en el extracto.');
      return;
    }
    await this.run(async () => {
      await this.collections.registerSuspense(this.estateId, {
        date: this.newForm.date,
        amount,
        concept: this.newForm.concept.trim(),
        ...(this.newForm.bankAccountId ? { bankAccountId: this.newForm.bankAccountId } : {}),
      });
      this.showNew.set(false);
      this.newForm = { ...this.newForm, amount: '', concept: '' };
    });
  }

  openApply(item: SuspenseItem): void {
    this.error.set(null);
    this.applyForm = { propertyId: '', amount: item.remaining.toFixed(2).replace('.', ','), date: today() };
    this.applying.set(item);
  }

  async apply(): Promise<void> {
    const item = this.applying();
    if (!item) return;
    const amount = parseEuros(this.applyForm.amount);
    if (!this.applyForm.propertyId) {
      this.error.set('Elige la propiedad que ha pagado.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > item.remaining + 1e-9) {
      this.error.set(`El importe debe estar entre 0,01 y ${this.fmtEur(item.remaining)}.`);
      return;
    }
    await this.run(async () => {
      await this.collections.applySuspense(item.id, {
        propertyId: this.applyForm.propertyId,
        amount,
        date: this.applyForm.date,
      });
      this.applying.set(null);
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    try {
      await fn();
      this.changed = true;
      this.items.set(await this.collections.listSuspense(this.estateId));
    } catch (error: any) {
      const msg = error?.error?.message;
      this.error.set(typeof msg === 'string' ? msg : 'No se pudo completar la operación.');
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.closed.emit({ changed: this.changed });
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
}
