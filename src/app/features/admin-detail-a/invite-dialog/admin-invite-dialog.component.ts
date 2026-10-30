import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { AdminsService } from '../../../core/admins.service';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Invitation link for the primary user of a despacho (no mailer: it is shared
 * by hand). Generates the link as soon as it opens. Used after «Añadir
 * administrador» and from the ficha 360° when nobody can sign in yet.
 */
@Component({
  selector: 'app-admin-invite-dialog',
  standalone: true,
  imports: [BtnComponent, IconComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <div class="modal" role="dialog" aria-modal="true" [attr.aria-label]="'Invitación a ' + adminName()" (click)="$event.stopPropagation()">
        <div class="modal__header">
          <h3>Invitación a {{ adminName() }}</h3>
          <button class="close-btn" aria-label="Cerrar" (click)="closed.emit()"><app-icon name="x" [size]="18"></app-icon></button>
        </div>
        <div class="modal__body">
          @if (error()) {
            <p class="invite-error">{{ error() }}</p>
          } @else if (link()) {
            <p class="modal__intro">
              Domora todavía no envía emails: comparte este enlace de un solo uso por el canal que prefieras (WhatsApp, email personal, etc.). Quien lo abra fija su contraseña y queda como usuario principal de esta administradora.
            </p>
            <div class="invite-link-box">
              <span class="invite-link-box__value">{{ link() }}</span>
              <app-btn variant="outline" size="sm" (clicked)="copy()">{{ copied() ? 'Copiado' : 'Copiar' }}</app-btn>
            </div>
          } @else {
            <p class="modal__intro">Generando el enlace…</p>
          }
        </div>
        <div class="modal__footer">
          <app-btn variant="primary" (clicked)="closed.emit()">Cerrar</app-btn>
        </div>
      </div>
    </div>
  `,
  styleUrl: './admin-invite-dialog.component.scss',
})
export class AdminInviteDialogComponent implements OnInit {
  private adminsSvc = inject(AdminsService);

  readonly administratorId = input.required<string>();
  readonly adminName = input.required<string>();
  readonly closed = output<void>();

  link = signal<string | null>(null);
  error = signal<string | null>(null);
  copied = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const { token } = await this.adminsSvc.createAdminInvite(this.administratorId());
      this.link.set(`${window.location.origin}/invite/${token}`);
    } catch (error) {
      console.error('Error generando el enlace de invitación', error);
      this.error.set('No se pudo generar el enlace de invitación.');
    }
  }

  async copy(): Promise<void> {
    const link = this.link();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch (error) {
      console.error('Error copiando el enlace', error);
    }
  }
}
