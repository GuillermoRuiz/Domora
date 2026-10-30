import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { DespachoContextService } from '../../core/despacho-context.service';
import { SUPPORT_MESSAGES, SupportSessionService } from '../../core/support-session.service';
import { SupportSessionDialogComponent } from '../support-session-dialog/support-session-dialog.component';

/**
 * Fixed band of role A while it looks at one despacho (odd/tasks/role-a-panel.md S1, S5):
 * «Viendo: <despacho> · Salir» on the role A screens, and a warning style while a support session is
 * open. Also surfaces the support denials (403) of the API with the offer to start support mode.
 * Role B screens are only reachable inside a session: when it ends, expires or the API rejects it,
 * the user goes back to the despacho ficha.
 */
@Component({
  selector: 'app-despacho-scope-band',
  standalone: true,
  imports: [SupportSessionDialogComponent],
  templateUrl: './despacho-scope-band.component.html',
  styleUrl: './despacho-scope-band.component.scss',
})
export class DespachoScopeBandComponent {
  private readonly auth = inject(AuthService);
  private readonly context = inject(DespachoContextService);
  private readonly support = inject(SupportSessionService);
  private readonly router = inject(Router);

  readonly despacho = computed(() => (this.auth.currentUser()?.role === 'A' ? this.context.selected() : null));
  readonly session = this.support.active;
  readonly denial = this.support.denial;
  readonly dialogOpen = signal(false);
  readonly ending = signal(false);
  readonly endError = signal<string | null>(null);

  constructor() {
    let seen = this.support.lost();
    effect(() => {
      const lost = this.support.lost();
      if (lost === seen) return;
      seen = lost;
      untracked(() => {
        const despacho = this.despacho();
        if (!this.router.url.startsWith('/b/')) return;
        void this.router.navigate(despacho ? ['/a/admins', despacho.id] : ['/a/admins']);
      });
    });
  }

  /** «Reiniciar» when the user already had a session that the API no longer accepts. */
  readonly startLabel = computed(() =>
    this.denial() === SUPPORT_MESSAGES.noSession ? 'Iniciar modo soporte' : 'Reiniciar modo soporte',
  );

  readonly expiresAt = computed(() => {
    const session = this.session();
    return session
      ? new Date(session.expiresAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
      : '';
  });

  leave(): void {
    this.context.clear();
    void this.router.navigateByUrl('/a/admins');
  }

  openDialog(): void {
    this.dialogOpen.set(true);
  }

  closeDialog(): void {
    this.dialogOpen.set(false);
  }

  startFromDenial(): void {
    this.support.dismissDenial();
    this.openDialog();
  }

  dismissDenial(): void {
    this.support.dismissDenial();
  }

  async endSession(): Promise<void> {
    if (this.ending()) return;
    this.ending.set(true);
    this.endError.set(null);
    try {
      await this.support.end();
    } catch {
      this.endError.set('No se ha podido finalizar el modo soporte. Inténtalo de nuevo.');
    } finally {
      this.ending.set(false);
    }
  }
}
