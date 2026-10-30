import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { ToggleComponent } from '../../../shared/components/toggle/toggle.component';
import { isValidDniOrNie } from '../../../core/spanish-id';
import type { ParticipationRow } from './meeting-workspace.model';

export interface Representative {
  /** Propietario de la comunidad (tiene cuenta, se identifica por email) o persona externa. */
  owner: { email: string } | null;
  external: { name: string; dni: string } | null;
}

export interface OwnerOption {
  email: string;
  fullName: string;
}

/**
 * Registrar o cambiar la representación de un propietario en la junta (art. 15.1
 * LPH). El representante es otro propietario de la comunidad —se elige de una
 * lista— o una persona externa, de la que se piden nombre completo y DNI.
 */
@Component({
  selector: 'app-meeting-representation-modal',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, ToggleComponent],
  templateUrl: './representation-modal.component.html',
  styleUrl: './representation-modal.component.scss',
})
export class MeetingRepresentationModalComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // El detalle de la junta es un contenedor (`container-type`) y encerraría el
    // `position: fixed` del fondo: se cuelga del <body> para cubrir toda la ventana.
    inject(DOCUMENT).body.appendChild(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  @Input({ required: true }) row!: ParticipationRow;
  /** Propietarios de la comunidad entre los que elegir; `null` mientras se cargan. */
  @Input() set owners(value: OwnerOption[] | null) {
    this.ownerOptions.set(value);
    // Sin propietarios que elegir (o aún sin cargar) se arranca en «persona externa».
    if (value && !value.length) this.isOwner.set(false);
  }
  @Input() busy = false;
  @Input() error = '';
  @Output() confirm = new EventEmitter<Representative>();
  @Output() closed = new EventEmitter<void>();

  readonly ownerOptions = signal<OwnerOption[] | null>(null);
  readonly isOwner = signal(true);
  readonly ownerEmail = signal('');
  readonly name = signal('');
  readonly dni = signal('');
  readonly touched = signal(false);

  readonly changing = computed(() => this.row.status === 'representado');
  readonly dniError = computed(() => {
    const value = this.dni().trim();
    if (!value) return 'Indica el DNI o NIE del representante.';
    return isValidDniOrNie(value) ? '' : 'El DNI/NIE no es válido (revisa la letra).';
  });
  readonly valid = computed(() =>
    this.isOwner()
      ? !!this.ownerEmail()
      : this.name().trim().length >= 3 && !this.dniError(),
  );

  submit(): void {
    this.touched.set(true);
    if (!this.valid() || this.busy) return;
    this.confirm.emit(
      this.isOwner()
        ? { owner: { email: this.ownerEmail() }, external: null }
        : { owner: null, external: { name: this.name().trim(), dni: this.dni().trim() } },
    );
  }

  close(): void {
    if (!this.busy) this.closed.emit();
  }
}
