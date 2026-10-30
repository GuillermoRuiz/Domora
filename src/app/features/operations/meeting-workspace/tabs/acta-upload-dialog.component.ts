import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, OnDestroy, Output, inject, signal } from '@angular/core';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';

/**
 * Pregunta, antes de subir el acta, en qué estado de firma está el archivo: ya firmado (la junta pasa a
 * firmada) o pendiente de firmar en Domora. La respuesta es obligatoria: no hay opción preseleccionada.
 */
@Component({
  selector: 'app-acta-upload-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent],
  templateUrl: './acta-upload-dialog.component.html',
  styleUrl: './acta-upload-dialog.component.scss',
})
export class ActaUploadDialogComponent implements OnDestroy {
  @Input({ required: true }) fileName = '';
  /** Ya hay un acta generada en Domora que el archivo sustituye. */
  @Input() replacesDraft = false;
  @Input() busy = false;
  /** Error devuelto al intentar subir. */
  @Input() error = '';
  /** `true`: el archivo ya está firmado. `false`: falta firmarlo en Domora. */
  @Output() confirmed = new EventEmitter<boolean>();
  @Output() closed = new EventEmitter<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly choice = signal<'signed' | 'pending' | null>(null);

  constructor() {
    inject(DOCUMENT).body.appendChild(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.host.nativeElement.remove();
  }

  get canSubmit(): boolean {
    return this.choice() !== null && !this.busy;
  }

  submit(): void {
    const choice = this.choice();
    if (choice && !this.busy) this.confirmed.emit(choice === 'signed');
  }

  close(): void {
    if (!this.busy) this.closed.emit();
  }
}
