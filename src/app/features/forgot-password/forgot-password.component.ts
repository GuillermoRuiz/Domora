import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './forgot-password.component.html',
  styleUrl: './forgot-password.component.scss',
})
export class ForgotPasswordComponent {
  private readonly auth = inject(AuthService);

  email = '';
  loading = signal(false);
  submitted = signal(false);
  message = signal<string | null>(null);

  async submit(): Promise<void> {
    if (!this.email) return;
    this.loading.set(true);
    try {
      const { message } = await this.auth.requestPasswordReset(this.email);
      this.message.set(message);
      this.submitted.set(true);
    } catch {
      // El backend siempre responde con el mismo mensaje genérico salvo
      // fallo real de red/servidor — en ese caso sí mostramos un error.
      this.message.set('No se pudo procesar la solicitud. Inténtalo de nuevo.');
      this.submitted.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
