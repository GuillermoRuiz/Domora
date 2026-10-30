import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { EstateContract, SupplierContract } from '../../../../core/models';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ContractDialogDirective } from '../dialog-behavior.directive';

/** Mensaje legible de un error de la API (el backend manda `message` como texto o como lista). */
function messageFrom(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } })?.error?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(' ');
  return fallback;
}

/** Confirmación de la cancelación de un contrato, con motivo opcional (queda registrado). */
@Component({
  selector: 'app-contract-cancel-modal',
  standalone: true,
  imports: [ContractDialogDirective, FormsModule, BtnComponent, IconComponent],
  templateUrl: './contract-cancel-modal.component.html',
  styleUrl: './contract-cancel-modal.component.scss',
})
export class ContractCancelModalComponent {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) contract!: EstateContract;
  @Output() cancelled = new EventEmitter<SupplierContract>();
  @Output() closed = new EventEmitter<void>();

  private api = inject(SuppliersStaffService);

  readonly reason = signal('');
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  async confirm(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const saved = await this.api.cancelSupplierContract(this.estateId, this.contract.supplierId, this.contract.id, this.reason().trim() || undefined);
      this.cancelled.emit(saved);
    } catch (error) {
      console.error('Error cancelando el contrato', error);
      this.error.set(messageFrom(error, 'No se pudo cancelar el contrato. Inténtalo de nuevo.'));
    } finally {
      this.saving.set(false);
    }
  }
}
