import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { StateService } from '../../core/state.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly state = inject(StateService);
  private readonly router = inject(Router);

  fullName = '';
  email = '';
  password = '';
  termsAccepted = false;
  loading = signal(false);
  errorMessage = signal<string | null>(null);

  async submit(): Promise<void> {
    if (!this.fullName || !this.email || !this.password) return;
    if (this.password.length < 8) {
      this.errorMessage.set('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (!this.termsAccepted) {
      this.errorMessage.set('Tienes que aceptar los Términos y la Política de Privacidad.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    try {
      await this.auth.register(this.email, this.password, this.fullName, this.termsAccepted);
      // Directo al wizard de alta — cerrar el círculo cuenta -> propiedad ->
      // solicitud de vinculación sin pasos intermedios.
      this.state.showAddPropertyModal.set(true);
      await this.router.navigateByUrl('/c/community');
    } catch (error: any) {
      const msg = error?.error?.message;
      this.errorMessage.set(typeof msg === 'string' ? msg : 'No se pudo crear la cuenta. Inténtalo de nuevo.');
    } finally {
      this.loading.set(false);
    }
  }
}
