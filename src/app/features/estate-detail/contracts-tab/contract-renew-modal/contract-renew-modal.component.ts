import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EstateContract, SupplierContract } from '../../../../core/models';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { formatDate } from '../contracts-model';
import { ContractDialogDirective } from '../dialog-behavior.directive';

/** Mensaje legible de un error de la API (el backend manda `message` como texto o como lista). */
function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Un año después de la fecha dada (ajusta el 29 de febrero). */
export function plusOneYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return isoDay(d);
}

/**
 * Renovar un contrato (D3): nuevo vencimiento y, si cambia con la renovación, el importe y su periodicidad.
 * Queda registrada en el histórico de renovaciones. La renovación tácita NO es automática: la registra el gestor.
 */
@Component({
  selector: 'app-contract-renew-modal',
  standalone: true,
  imports: [ContractDialogDirective, FormsModule, SelectDropdownDirective, BtnComponent, IconComponent],
  templateUrl: './contract-renew-modal.component.html',
  styleUrl: './contract-renew-modal.component.scss',
})
export class ContractRenewModalComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) contract!: EstateContract;
  @Output() renewed = new EventEmitter<SupplierContract>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(SuppliersStaffService);

  readonly newEnd = signal('');
  readonly costAmount = signal<number | null>(null);
  readonly costFrequency = signal<SupplierContract['costFrequency']>(null);
  readonly notes = signal('');
  readonly submitted = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly currentEnd = computed(() => formatDate(this.contract.endDate));
  readonly endInvalid = computed(() => {
    const value = this.newEnd();
    if (!value) return this.submitted() ? 'Indica el nuevo vencimiento.' : null;
    if (this.contract.endDate && value <= this.contract.endDate) return 'Debe ser posterior al vencimiento actual.';
    if (value <= isoDay(new Date())) return 'Debe ser posterior a hoy.';
    return null;
  });

  ngOnInit(): void {
    const base = this.contract.endDate && this.contract.endDate > isoDay(new Date()) ? this.contract.endDate : isoDay(new Date());
    this.newEnd.set(plusOneYear(base));
    this.costAmount.set(this.contract.costAmount ?? null);
    this.costFrequency.set(this.contract.costFrequency ?? null);
  }

  async submit(): Promise<void> {
    this.submitted.set(true);
    if (this.saving() || this.endInvalid()) return;
    const amount = this.costAmount();
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      this.error.set('El importe debe ser mayor o igual a cero.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      // Lo que no cambia no se envía: el contrato conserva su importe y periodicidad.
      const amountChanged = amount !== (this.contract.costAmount ?? null);
      const frequencyChanged = this.costFrequency() !== (this.contract.costFrequency ?? null);
      const saved = await this.api.renewSupplierContract(this.estateId, this.contract.supplierId, this.contract.id, {
        newEndDate: this.newEnd(),
        ...(amountChanged && { costAmount: amount }),
        ...(frequencyChanged && { costFrequency: this.costFrequency() }),
        ...(this.notes().trim() && { notes: this.notes().trim() }),
      });
      this.renewed.emit(saved);
    } catch (error) {
      console.error('Error renovando el contrato', error);
      this.error.set(messageFrom(error, 'No se pudo renovar el contrato. Inténtalo de nuevo.'));
    } finally {
      this.saving.set(false);
    }
  }
}
