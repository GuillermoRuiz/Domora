import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { BtnComponent } from '../btn/btn.component';
import { IconComponent } from '../icon/icon.component';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  /** Texto del botón de confirmación (por defecto «Confirmar»). */
  confirmLabel?: string;
  /** Texto del botón de cancelación (por defecto «Cancelar»). */
  cancelLabel?: string;
  /** `danger` para acciones destructivas o que no se pueden deshacer. */
  tone?: 'primary' | 'danger';
}

let nextId = 0;

/**
 * Diálogo de confirmación de la aplicación — sustituye al `confirm()` del navegador.
 * No se usa directamente: se abre con `ConfirmDialogService.ask()`.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
})
export class ConfirmDialogComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) options!: ConfirmDialogOptions;
  @Output() decided = new EventEmitter<boolean>();

  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;
  readonly titleId = `confirm-dialog-title-${nextId++}`;
  readonly messageId = `confirm-dialog-message-${nextId}`;

  /**
   * Esc cancela el diálogo y no llega al modal que haya detrás (que también cierra con Esc):
   * se escucha en fase de captura y se corta ahí.
   */
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    this.cancel();
  };

  ngAfterViewInit(): void {
    document.addEventListener('keydown', this.onEscape, true);
    // El foco entra en el diálogo; el botón de cancelar es el menos destructivo.
    this.dialog?.nativeElement.querySelector<HTMLElement>('[data-initial-focus] button')?.focus();
  }

  ngOnDestroy(): void {
    document.removeEventListener('keydown', this.onEscape, true);
  }

  cancel(): void {
    this.decided.emit(false);
  }

  confirm(): void {
    this.decided.emit(true);
  }

  /** El foco no sale del diálogo mientras está abierto. */
  trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const buttons = Array.from(this.dialog?.nativeElement.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    if (!buttons.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
