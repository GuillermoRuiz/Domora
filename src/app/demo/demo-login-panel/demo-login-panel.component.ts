import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { ROLE_HOME } from '../../core/role-home';
import { DEMO_ACCOUNTS, type DemoAccount } from '../demo-accounts';

/**
 * Botón "Modo demo" + modal para entrar con una cuenta de prueba. Solo existe
 * en el build `demo` (se carga vía demo-ui.demo.ts); el login lo monta con
 * ngComponentOutlet y en producción ni siquiera llega al bundle.
 */
@Component({
  selector: 'app-demo-login-panel',
  standalone: true,
  templateUrl: './demo-login-panel.component.html',
  styleUrl: './demo-login-panel.component.scss',
})
export class DemoLoginPanelComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);


  readonly accounts = DEMO_ACCOUNTS;

  showModal = signal(false);
  loadingEmail = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  openModal(): void {
    this.errorMessage.set(null);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  async loginAs(account: DemoAccount): Promise<void> {
    this.loadingEmail.set(account.email);
    this.errorMessage.set(null);
    try {
      await this.auth.login(account.email, account.password);
      const role = this.auth.currentUser()?.role ?? account.role;
      this.showModal.set(false);
      await this.router.navigateByUrl(ROLE_HOME[role]);
    } catch {
      this.errorMessage.set('No se pudo iniciar la sesión de demo.');
    } finally {
      this.loadingEmail.set(null);
    }
  }
}
