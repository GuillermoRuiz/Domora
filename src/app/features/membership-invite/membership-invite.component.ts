import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { MembershipsMessagingService } from '../../core/memberships-messaging.service';
import { MembershipInviteInfo } from '../../core/models';

/**
 * Landing de `/membership-invite/:token` — puerto del mismo molde que
 * `team-invite.component.ts`, pero a diferencia de ese (que crea una
 * cuenta desde cero), acá el canje requiere sesión iniciada: quien abre el
 * enlace puede ya tener cuenta propia (p. ej. ya es propietario C de otra
 * unidad). Sin sesión, se lo manda a iniciarla/registrarse y a volver a
 * abrir el mismo enlace — el token sigue vigente durante su TTL de 7 días.
 */
@Component({
  selector: 'app-membership-invite',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './membership-invite.component.html',
  styleUrl: './membership-invite.component.scss',
})
export class MembershipInviteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly memberships = inject(MembershipsMessagingService);

  private token = '';

  checking = signal(true);
  inviteError = signal<string | null>(null);
  info = signal<MembershipInviteInfo | null>(null);

  redeeming = signal(false);
  redeemError = signal<string | null>(null);

  get isLoggedIn(): boolean {
    return !!this.auth.currentUser();
  }

  async ngOnInit(): Promise<void> {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.inviteError.set('Enlace de invitación inválido.');
      this.checking.set(false);
      return;
    }
    try {
      this.info.set(await this.memberships.getMembershipInviteInfo(this.token));
    } catch (error: any) {
      const msg = error?.error?.message;
      this.inviteError.set(typeof msg === 'string' ? msg : 'El enlace de invitación no es válido o ya fue utilizado.');
    } finally {
      this.checking.set(false);
    }
  }

  async accept(): Promise<void> {
    this.redeeming.set(true);
    this.redeemError.set(null);
    try {
      const membership = await this.memberships.redeemMembershipInvite(this.token);
      // La finca de la propiedad recién vinculada aún no está en el token.
      // Si recargar falla, la vinculación ya está hecha: se navega igual.
      await this.auth.reloadSession().catch((error: unknown) =>
        console.error('Error recargando la sesión tras aceptar la invitación', error),
      );
      await this.router.navigateByUrl(`/c/properties/${membership.propertyId}`);
    } catch (error: any) {
      const msg = error?.error?.message;
      this.redeemError.set(typeof msg === 'string' ? msg : 'No se pudo aceptar la invitación. Inténtalo de nuevo.');
    } finally {
      this.redeeming.set(false);
    }
  }
}
