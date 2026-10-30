import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
})
export class ResetPasswordComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  private token = '';

  checking = signal(true);
  tokenError = signal<string | null>(null);

  password = '';
  confirmPassword = '';
  submitting = signal(false);
  submitError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.tokenError.set('Enlace de recuperación inválido.');
      this.checking.set(false);
      return;
    }
    try {
      await this.auth.checkPasswordResetToken(this.token);
    } catch (error: any) {
      const msg = error?.error?.message;
      this.tokenError.set(typeof msg === 'string' ? msg : 'El enlace de recuperación no es válido o ya fue utilizado.');
    } finally {
      this.checking.set(false);
    }
  }

  async submit(): Promise<void> {
    if (!this.password) return;
    if (this.password.length < 8) {
      this.submitError.set('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.submitError.set('Las contraseñas no coinciden.');
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    try {
      await this.auth.resetPassword(this.token, this.password);
      // No inicia sesión automáticamente — se pide iniciar sesión de nuevo
      // con la contraseña nueva (acción sensible, mismo criterio que
      // cualquier flujo de reset de contraseña estándar).
      await this.router.navigate(['/login'], { queryParams: { passwordReset: '1' } });
    } catch (error: any) {
      const msg = error?.error?.message;
      this.submitError.set(typeof msg === 'string' ? msg : 'No se pudo restablecer la contraseña. Inténtalo de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }
}
