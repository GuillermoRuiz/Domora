import { Component, inject, output, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DespachoContextService } from '../../core/despacho-context.service';
import { SupportSessionService } from '../../core/support-session.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

export const SUPPORT_REASON_MAX = 500;
export const SUPPORT_TICKET_MAX = 100;

/** Starts a support session on the selected despacho (odd/tasks/role-a-panel.md S5). */
@Component({
  selector: 'app-support-session-dialog',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './support-session-dialog.component.html',
  styleUrl: './support-session-dialog.component.scss',
})
export class SupportSessionDialogComponent {
  private readonly support = inject(SupportSessionService);
  readonly despacho = inject(DespachoContextService).selected;

  readonly closed = output<void>();
  /** Emitted, before `closed`, once the session is open. */
  readonly started = output<void>();

  readonly reasonMax = SUPPORT_REASON_MAX;
  readonly ticketMax = SUPPORT_TICKET_MAX;
  readonly reason = signal('');
  readonly ticketRef = signal('');
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.saving()) return;
    const reason = this.reason().trim();
    if (!reason) {
      this.error.set('Indica el motivo de la sesión de soporte.');
      return;
    }
    if (reason.length > SUPPORT_REASON_MAX) {
      this.error.set(`El motivo no puede superar los ${SUPPORT_REASON_MAX} caracteres.`);
      return;
    }
    if (this.ticketRef().trim().length > SUPPORT_TICKET_MAX) {
      this.error.set(`El ticket o referencia no puede superar los ${SUPPORT_TICKET_MAX} caracteres.`);
      return;
    }
    this.error.set(null);
    this.saving.set(true);
    try {
      await this.support.start({ reason, ticketRef: this.ticketRef() });
      this.started.emit();
      this.closed.emit();
    } catch (error) {
      this.error.set(messageFrom(error));
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.closed.emit();
  }
}

function messageFrom(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const message = error.error?.message;
    if (Array.isArray(message) && message.length) return message.join(' ');
    if (typeof message === 'string' && message) return message;
  }
  return 'No se ha podido iniciar el modo soporte. Inténtalo de nuevo.';
}
