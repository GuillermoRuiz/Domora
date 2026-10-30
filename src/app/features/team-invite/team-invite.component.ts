import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-team-invite',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './team-invite.component.html',
  styleUrl: './team-invite.component.scss',
})
export class TeamInviteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  private token = '';

  checking = signal(true);
  administratorName = signal<string | null>(null);
  inviteError = signal<string | null>(null);

  fullName = '';
  email = '';
  password = '';
  termsAccepted = false;
  submitting = signal(false);
  submitError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.inviteError.set('Enlace de invitación inválido.');
      this.checking.set(false);
      return;
    }
    try {
      const info = await this.auth.getTeamInviteInfo(this.token);
      this.administratorName.set(info.administratorName);
    } catch (error: any) {
      const msg = error?.error?.message;
      this.inviteError.set(typeof msg === 'string' ? msg : 'El enlace de invitación no es válido o ya fue utilizado.');
    } finally {
      this.checking.set(false);
    }
  }

  async submit(): Promise<void> {
    if (!this.fullName || !this.email || !this.password) return;
    if (this.password.length < 8) {
      this.submitError.set('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (!this.termsAccepted) {
      this.submitError.set('Tienes que aceptar los Términos y la Política de Privacidad.');
      return;
    }

    this.submitting.set(true);
    this.submitError.set(null);
    try {
      await this.auth.redeemTeamInvite(this.token, this.email, this.password, this.fullName, this.termsAccepted);
      await this.router.navigateByUrl('/b/estates');
    } catch (error: any) {
      const msg = error?.error?.message;
      this.submitError.set(typeof msg === 'string' ? msg : 'No se pudo completar el alta. Inténtalo de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }
}
