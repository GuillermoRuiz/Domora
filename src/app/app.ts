import { NgComponentOutlet } from '@angular/common';
import { Component, computed, effect, inject, untracked, type Type } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { environment } from '../environments/environment';
import { DemoBanner } from './demo/demo-ui';
import { StateService } from './core/state.service';
import { AuthService } from './core/auth.service';
import { NavigationStatusService } from './core/navigation-status.service';
import { OfficeSetupService } from './core/office-setup.service';
import { SidebarComponent } from './layout/sidebar/sidebar.component';
import { AddPropertyComponent } from './features/add-property/add-property.component';
import { DespachoScopeBandComponent } from './layout/despacho-scope-band/despacho-scope-band.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NgComponentOutlet, SidebarComponent, AddPropertyComponent, DespachoScopeBandComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  constructor() {
    // Activate the singleton loader independently of sidebar/header instances.
    inject(NavigationStatusService);
    // La puesta en marcha pendiente del despacho (rol B) se muestra en el menú de cuenta de cualquier pantalla: se pide una vez por sesión, no por cada cabecera.
    const officeSetup = inject(OfficeSetupService);
    effect(() => {
      if (this.auth.currentUser()?.role === 'B') untracked(() => void officeSetup.loadOwn());
    });
  }

  state = inject(StateService);

  /** Botón flotante "Rol": solo donde hay selector de roles mock (desarrollo). En prod/demo es false. */
  showRoleSwitcher = environment.mockRoleSwitch;

  /** Banner "Entorno de demostración": `null` salvo en el build `demo` (ver demo/demo-ui.ts). */
  demoBanner: Type<unknown> | null = DemoBanner;

  // El shell (sidebar + role-switcher) solo debe montarse con sesión activa
  // — nunca por coincidencia de ruta. Rutas públicas nuevas (forgot-password,
  // reset-password/:token, register, invite/:token, ...) quedan cubiertas
  // automáticamente sin tener que listarlas una por una.
  //
  // Es seguro leer `isAuthenticated()` desde el primer render: `restoreSession()`
  // corre como APP_INITIALIZER (ver app.config.ts) y el bootstrap se bloquea
  // hasta que resuelve, así que el Router nunca arranca a navegar con el
  // estado de sesión todavía indefinido.
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  isAuthenticated = this.auth.isAuthenticated;

  /**
   * Aviso de estado de suscripción (rol B) — puramente informativo: quien
   * de verdad corta el acceso es el backend (SubscriptionStatusGuard), esto
   * solo evita que el primer aviso de "no puedes guardar" les llegue como
   * una sorpresa en mitad de un formulario.
   */
  subscriptionBanner = computed(() => {
    const user = this.auth.currentUser();
    if (!user || user.role !== 'B') return null;
    switch (user.subscriptionStatus) {
      case 'Periodo de gracia':
        return { tone: 'warn' as const, text: 'Tu suscripción está en periodo de gracia. Regulariza el pago para evitar interrupciones.' };
      case 'Vencida':
        return { tone: 'danger' as const, text: 'Tu suscripción está vencida: puedes consultar tus datos, pero no crear ni modificar nada hasta regularizar el pago.' };
      case 'Bloqueada':
        return { tone: 'danger' as const, text: 'Tu cuenta está suspendida. Contacta con Domora para regularizarla.' };
      default:
        return null;
    }
  });

  goToSubscription(): void {
    void this.router.navigate(['/b/subscription']);
  }
}
