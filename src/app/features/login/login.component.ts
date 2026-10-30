import { NgComponentOutlet } from '@angular/common';
import { Component, inject, signal, type Type } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { ROLE_HOME } from '../../core/role-home';
import { DemoLoginPanel } from '../../demo/demo-ui';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, NgComponentOutlet],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);


  /** true si venimos de /reset-password con la contraseña recién cambiada. */
  readonly passwordResetSuccess = this.route.snapshot.queryParamMap.get('passwordReset') === '1';

  /**
   * Botón + modal de "Modo demo". `null` en producción: solo el build `demo`
   * sustituye `demo-ui.ts` (fileReplacements) por la versión con el
   * componente, así que ni el texto ni las credenciales llegan al bundle prod.
   */
  demoPanel: Type<unknown> | null = DemoLoginPanel;

  email = '';
  password = '';
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  async submit(): Promise<void> {
    if (!this.email || !this.password) return;

    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      await this.auth.login(this.email, this.password);
      const role = this.auth.currentUser()?.role ?? 'B';
      await this.router.navigateByUrl(ROLE_HOME[role]);
    } catch {
      this.errorMessage.set('Email o contraseña incorrectos.');
    } finally {
      this.loading.set(false);
    }
  }
}
