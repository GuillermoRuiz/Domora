import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { suggestedReviewFrequency } from '../../../../core/contract-hints';
import type { EstateContract, SupplierContract } from '../../../../core/models';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ContractDialogDirective } from '../dialog-behavior.directive';

/** Mensaje legible de un error de la API (el backend manda `message` como texto o como lista). */
function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Alta y edición de un contrato desde la pestaña «Contratos» (D1, D2). Al crear se elige el proveedor
 * entre los de la finca; al editar el proveedor queda fijo. Mismos campos y reglas que el formulario de
 * la pestaña Proveedores.
 */
@Component({
  selector: 'app-contract-form-modal',
  standalone: true,
  imports: [ContractDialogDirective, FormsModule, SelectDropdownDirective, BtnComponent, IconComponent],
  templateUrl: './contract-form-modal.component.html',
  styleUrl: './contract-form-modal.component.scss',
})
export class ContractFormModalComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  /** Contrato a editar; sin él, se crea uno nuevo. */
  @Input() contract: EstateContract | null = null;
  @Output() saved = new EventEmitter<SupplierContract>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(SuppliersStaffService);

  readonly suppliers = signal<{ id: string; name: string; category: string }[] | null>(null);
  readonly supplierId = signal('');
  readonly serviceType = signal('');
  readonly startDate = signal(todayIso());
  readonly endDate = signal('');
  readonly renewalType = signal<SupplierContract['renewalType']>('tacita');
  readonly reviewFrequency = signal('');
  readonly costAmount = signal<number | null>(null);
  readonly costFrequency = signal<SupplierContract['costFrequency']>(null);
  readonly currency = signal('EUR');
  readonly notes = signal('');
  /** Nº de contrato o de póliza (seguros). */
  readonly contractNumber = signal('');
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly editing = computed(() => this.contract !== null);
  readonly serviceInvalid = computed(() => this.submitted() && this.serviceType().trim() === '');
  readonly startInvalid = computed(() => this.submitted() && this.startDate() === '');
  readonly supplierInvalid = computed(() => this.submitted() && !this.editing() && this.supplierId() === '');
  readonly endInvalid = computed(() => this.endDate() !== '' && this.startDate() !== '' && this.endDate() < this.startDate());

  async ngOnInit(): Promise<void> {
    const c = this.contract;
    if (c) {
      this.supplierId.set(c.supplierId);
      this.serviceType.set(c.serviceType);
      this.startDate.set(c.startDate);
      this.endDate.set(c.endDate ?? '');
      this.renewalType.set(c.renewalType);
      this.reviewFrequency.set(c.reviewFrequency ?? '');
      this.costAmount.set(c.costAmount ?? null);
      this.costFrequency.set(c.costFrequency ?? null);
      this.currency.set(c.currency ?? 'EUR');
      this.notes.set(c.notes ?? '');
      this.contractNumber.set(c.contractNumber ?? '');
    }
    try {
      const list = await this.api.listSuppliers(this.estateId);
      this.suppliers.set(list.filter((s) => s.status === 'Activo' || s.id === c?.supplierId).map((s) => ({ id: s.id, name: s.name, category: s.category })));
    } catch (error) {
      console.error('Error cargando los proveedores de la finca', error);
      this.suppliers.set([]);
    }
  }

  /** Al elegir proveedor en un alta, propone su categoría como servicio si todavía no se ha escrito nada. */
  onSupplierChange(id: string): void {
    this.supplierId.set(id);
    if (this.editing()) return;
    const supplier = this.suppliers()?.find((s) => s.id === id);
    if (supplier && this.serviceType().trim() === '') this.onServiceTypeChange(supplier.category);
  }

  /** Solo sugiere la cadencia de revisión al crear: al editar no pisa lo que el gestor ya ajustó. */
  onServiceTypeChange(value: string): void {
    this.serviceType.set(value);
    if (!this.editing()) {
      const suggested = suggestedReviewFrequency(value);
      if (suggested) this.reviewFrequency.set(suggested);
    }
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.saving()) return;
    if (this.serviceInvalid() || this.startInvalid() || this.supplierInvalid()) return;
    if (this.endInvalid()) {
      this.error.set('La fecha de fin no puede ser anterior a la de inicio.');
      return;
    }
    const amount = this.costAmount();
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      this.error.set('El coste debe ser un importe mayor o igual a cero.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(this.currency())) {
      this.error.set('Indica una moneda ISO de tres letras (por ejemplo EUR).');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const base = {
        serviceType: this.serviceType().trim(),
        startDate: this.startDate(),
        renewalType: this.renewalType(),
        costAmount: this.costAmount(),
        costFrequency: this.costFrequency(),
        currency: this.currency(),
        reviewFrequency: this.reviewFrequency().trim() || undefined,
        notes: this.notes().trim() || undefined,
      };
      const saved = this.contract
        // Al editar, vaciar la fecha de fin la quita (contrato indefinido).
        ? await this.api.updateSupplierContract(this.estateId, this.contract.supplierId, this.contract.id, { ...base, endDate: this.endDate() || null, contractNumber: this.contractNumber().trim() || null })
        : await this.api.createSupplierContract(this.estateId, this.supplierId(), { ...base, endDate: this.endDate() || undefined, contractNumber: this.contractNumber().trim() || undefined });
      this.saved.emit(saved);
    } catch (error) {
      console.error('Error guardando el contrato', error);
      this.error.set(messageFrom(error, 'No se pudo guardar el contrato. Inténtalo de nuevo.'));
    } finally {
      this.saving.set(false);
    }
  }
}
