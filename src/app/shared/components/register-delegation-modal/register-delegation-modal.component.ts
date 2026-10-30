import { Component, EventEmitter, Input, OnChanges, Output, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { BtnComponent } from '../btn/btn.component';
import { MeetingVoteDelegationsService } from '../../../core/meeting-vote-delegations.service';

import { SelectDropdownDirective } from '../dropdown/select-dropdown.directive';
/**
 * Delegación de voto (art. 15.1 LPH) — compartido entre la ficha de junta
 * de la gestora (`meeting-detail`, elige propiedad y delegador) y el
 * autoservicio del vecino (`juntas-section`, propiedad y delegador
 * bloqueados a sí mismo — ver `lockedPropertyId`/`lockedDelegatorUserId`).
 */
@Component({
  selector: 'app-register-delegation-modal',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, SelectDropdownDirective],
  templateUrl: './register-delegation-modal.component.html',
  styleUrl: './register-delegation-modal.component.scss',
})
export class RegisterDelegationModalComponent implements OnChanges {
  @Input({ required: true }) meetingId!: string;
  /** Censo de propiedades entre las que elegir — ignorado si `lockedPropertyId` viene informado. */
  @Input() properties: { id: string; ref?: string | null }[] = [];
  @Input() lockedPropertyId?: string;
  @Input() lockedDelegatorUserId?: string;
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<void>();

  private readonly delegationsSvc = inject(MeetingVoteDelegationsService);

  selectedPropertyId = signal<string | null>(null);
  eligibleDelegators = signal<{ userId: string; name: string }[]>([]);
  selectedDelegatorUserId = signal<string | null>(null);
  representativeEmail = signal('');
  notes = signal('');
  file = signal<File | null>(null);
  saving = signal(false);
  error = signal<string | null>(null);

  ngOnChanges(): void {
    if (this.lockedPropertyId) this.selectedPropertyId.set(this.lockedPropertyId);
    if (this.lockedDelegatorUserId) this.selectedDelegatorUserId.set(this.lockedDelegatorUserId);
  }

  async onPropertyChange(propertyId: string): Promise<void> {
    this.selectedPropertyId.set(propertyId || null);
    this.selectedDelegatorUserId.set(this.lockedDelegatorUserId ?? null);
    this.eligibleDelegators.set([]);
    if (!propertyId || this.lockedDelegatorUserId) return;
    try {
      this.eligibleDelegators.set(
        await this.delegationsSvc.listEligibleDelegators(this.meetingId, propertyId),
      );
    } catch (error) {
      console.error('Error cargando los titulares de la propiedad', error);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
  }

  canSubmit(): boolean {
    return !!this.selectedPropertyId() && !!this.selectedDelegatorUserId() && !!this.representativeEmail().trim();
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const created = await this.delegationsSvc.create(this.meetingId, {
        propertyId: this.selectedPropertyId()!,
        delegatorUserId: this.selectedDelegatorUserId()!,
        representativeEmail: this.representativeEmail().trim(),
        notes: this.notes().trim() || undefined,
      });
      const file = this.file();
      if (file) {
        await this.delegationsSvc.uploadDocument(this.meetingId, created.id, file);
      }
      this.created.emit();
      this.close();
    } catch (error: any) {
      console.error('Error registrando la delegación', error);
      const msg = error?.error?.message;
      this.error.set(typeof msg === 'string' ? msg : 'No se pudo registrar la delegación.');
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.closed.emit();
  }
}
