import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { ToggleComponent } from '../../shared/components/toggle/toggle.component';
import { TwoFactorEnrollmentComponent } from '../../shared/components/two-factor-enrollment/two-factor-enrollment.component';
import { StateService } from '../../core/state.service';
import { MembershipsMessagingService } from '../../core/memberships-messaging.service';
import { AdminsService } from '../../core/admins.service';
import { NotificationsService } from '../../core/notifications.service';
import { PushSubscriptionService } from '../../core/push-subscription.service';
import { DirectMessagePolicy, DisplayNamePolicy, NotificationCategory, NotificationPreference, OwnAdministrator, UserMessagingSettings } from '../../core/models';

import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
import { BillingCardComponent } from './billing-card/billing-card.component';
import { OfficeSetupComponent } from './office-setup/office-setup.component';
import { OfficeSetupService } from '../../core/office-setup.service';
/** Texto de cada categoría — el backend solo manda `category`/`emailEnabled`, sin etiquetas. */
const NOTIF_CATEGORY_META: Record<NotificationCategory, { label: string; sub: string }> = {
  adhesion: { label: 'Solicitudes de adhesión', sub: 'Nuevos vecinos que quieren vincularse' },
  onboarding: { label: 'Altas de comunidad nueva', sub: 'Propietarios que piden dar de alta su comunidad' },
  issue: { label: 'Incidencias', sub: 'Nuevas incidencias y avisos a los vecinos afectados' },
  direct_message: { label: 'Mensajes directos', sub: 'Mensajes de propietarios e inquilinos' },
  inspection: { label: 'Inspecciones normativas', sub: 'Vencimientos y citas de inspección' },
  meeting: { label: 'Juntas', sub: 'Cuando una junta se celebra o se cancela' },
  communication: { label: 'Comunicados urgentes', sub: 'Avisos urgentes y notificaciones fehacientes' },
  booking: { label: 'Reservas de zonas comunes', sub: 'Cancelaciones de reservas que gestionas' },
  receipt: { label: 'Recibos y pagos', sub: 'Recibos generados y recordatorios de impago' },
  billing: { label: 'Facturación y pagos', sub: 'Avisos sobre tu suscripción y método de pago' },
  task: { label: 'Recordatorios de tareas', sub: 'Aviso previo al inicio de las tareas de tu agenda' },
  document: { label: 'Documentos de la comunidad', sub: 'Cuando la gestora comparte documentos contigo' },
};

interface SessionRow {
  device: string;
  location: string;
  time: string;
  current: boolean;
}

interface IntegrationRow {
  id: string;
  icon: string;
  label: string;
  sub: string;
  status: 'connected' | 'disconnected';
  actionLabel: string;
  toastMsg: string;
  /** Si está presente, manageIntegration() navega en vez de mostrar un toast. */
  route?: string;
}

// Sin 'neighbors' ni 'address': el rol B no tiene propiedades — no hay
// distinción de "vecinos" ni una dirección propia que mostrar.
const DIRECT_MESSAGE_OPTIONS: { value: DirectMessagePolicy; label: string }[] = [
  { value: 'nobody', label: 'Nadie' },
  { value: 'anyone_linked', label: 'Cualquier propietario de mis fincas' },
];

const DISPLAY_NAME_OPTIONS: { value: DisplayNamePolicy; label: string }[] = [
  { value: 'full_name', label: 'Nombre y apellidos' },
  { value: 'alias', label: 'Un alias' },
];

const INTEGRATIONS: IntegrationRow[] = [
  { id: 'sepa', icon: 'card', label: 'Banca online (SEPA / Cuaderno 19)', sub: 'Genera y procesa remesas directamente desde tu entidad bancaria', status: 'connected', actionLabel: 'Configurar', toastMsg: 'Redirigiendo a configuración SEPA…' },
  { id: 'firma', icon: 'key', label: 'Firma electrónica', sub: 'Válida documentos con firma digital reconocida (eIDAS)', status: 'connected', actionLabel: 'Gestionar', toastMsg: 'Abriendo panel de firma electrónica…' },
  { id: 'docs', icon: 'file-text', label: 'Gestor documental externo', sub: 'Sincroniza documentos con Google Drive, Dropbox o SharePoint', status: 'disconnected', actionLabel: 'Conectar', toastMsg: 'Función disponible próximamente' },
  { id: 'portal', icon: 'eye', label: 'Portal del propietario (web pública)', sub: 'Activa la vista pública para que propietarios accedan sin app', status: 'disconnected', actionLabel: 'Activar', toastMsg: 'Función disponible próximamente' },
  { id: 'migracion', icon: 'upload', label: 'Migrar desde otra plataforma', sub: 'Importa fincas, propietarios y datos desde Gesfincas u otro programa', status: 'disconnected', actionLabel: 'Empezar migración', toastMsg: '', route: '/b/migracion' },
];

@Component({
  selector: 'app-ajustes',
  standalone: true,
  imports: [TopbarComponent, IconComponent, BtnComponent, AvatarComponent, ToggleComponent, FormsModule, RouterLink, TwoFactorEnrollmentComponent, SelectDropdownDirective, BillingCardComponent, OfficeSetupComponent],
  templateUrl: './ajustes.component.html',
  styleUrl: './ajustes.component.scss'
})
export class AjustesComponent implements OnInit {
  state = inject(StateService);
  private data = inject(MembershipsMessagingService);
  private admins = inject(AdminsService);
  private officeSetup = inject(OfficeSetupService);
  private notifications = inject(NotificationsService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private push = inject(PushSubscriptionService);

  pushSupported = this.push.isSupported;
  pushSubscribed = this.push.isSubscribed;
  pushBusy = this.push.busy;

  async togglePush(): Promise<void> {
    if (this.pushSubscribed()) {
      await this.push.unsubscribe();
    } else {
      await this.push.subscribe();
    }
  }

  // Privacidad y mensajería (rol B — ajuste global, sin PropertyMembership)
  messagingSettings = signal<UserMessagingSettings | null>(null);
  messagingSettingsLoading = signal(true);
  displayAliasDraft = signal('');
  directMessageOptions = DIRECT_MESSAGE_OPTIONS;
  displayNameOptions = DISPLAY_NAME_OPTIONS;

  /** Los enlaces de la puesta en marcha llevan a su sección con un fragmento (#ajustes-…). */
  private readonly scrollToFragment = this.route.fragment.pipe(takeUntilDestroyed()).subscribe((fragment) => {
    if (fragment) setTimeout(() => document.getElementById(fragment)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
  });

  async ngOnInit(): Promise<void> {
    void this.loadEmpresa();
    void this.officeSetup.loadOwn();
    try {
      const settings = await this.data.getMyMessagingSettings();
      this.messagingSettings.set(settings);
      this.displayAliasDraft.set(settings.displayAlias ?? '');
    } catch (error) {
      console.error('Error cargando los ajustes de mensajería', error);
    } finally {
      this.messagingSettingsLoading.set(false);
    }
    try {
      this.notifPrefs.set(await this.notifications.getPreferences());
    } catch (error) {
      console.error('Error cargando las preferencias de notificación', error);
    } finally {
      this.notifPrefsLoading.set(false);
    }
  }

  notifLabel(category: NotificationCategory): string {
    return NOTIF_CATEGORY_META[category].label;
  }

  notifSub(category: NotificationCategory): string {
    return NOTIF_CATEGORY_META[category].sub;
  }

  private async updateMessagingSetting(patch: Partial<UserMessagingSettings>): Promise<void> {
    const current = this.messagingSettings();
    if (!current) return;
    this.messagingSettings.set({ ...current, ...patch });
    try {
      this.messagingSettings.set(await this.data.updateMyMessagingSettings(patch));
      this.showToast('Ajustes actualizados');
    } catch (error) {
      console.error('Error guardando los ajustes de mensajería', error);
      this.messagingSettings.set(current);
      this.showToast('No se pudieron guardar los ajustes');
    }
  }

  setMessagingPolicy(value: DirectMessagePolicy): void {
    void this.updateMessagingSetting({ allowDirectMessages: value });
  }

  setDisplayNamePolicy(value: DisplayNamePolicy): void {
    void this.updateMessagingSetting({ displayNamePolicy: value });
  }

  saveDisplayAlias(): void {
    const alias = this.displayAliasDraft().trim();
    if (alias === (this.messagingSettings()?.displayAlias ?? '')) return;
    void this.updateMessagingSetting({ displayAlias: alias });
  }

  // Perfil
  editPerfil = signal(false);
  nombre = signal('Marcos Noriega');
  email = signal('marcos.noriega@gestora-med.es');
  phone = signal('+34 934 567 890');
  nif = signal('52.348.901-K');
  colegiado = signal('AI-08-04821');

  // Empresa — datos reales de la gestora (antes eran valores fijos que fingían guardarse)
  editEmpresa = signal(false);
  /** Puesta en marcha del despacho: es una ayuda, si falla la tarjeta no aparece. */
  office = this.officeSetup.own;
  empresa = signal<OwnAdministrator | null>(null);
  empresaError = signal<string | null>(null);
  empresaSaving = signal(false);
  empPhone = signal('');
  empContactName = signal('');
  empContactEmail = signal('');
  empVatNumber = signal('');
  empContactEmailInvalid = computed(() => {
    const email = this.empContactEmail().trim();
    return email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  });

  // Notificaciones — la bandeja en sí (avisos internos) siempre está activa
  // para la gestora; esto solo controla si además sale un email por
  // categoría (`UserNotificationPreference`, sin fila = activado).
  notifPrefs = signal<NotificationPreference[]>([]);
  notifPrefsLoading = signal(true);

  // Preferencias
  idioma = signal('Español (ES)');
  idiomas = ['Español (ES)', 'Català (CA)', 'English (EN)'];
  zona = signal('Europe/Madrid (UTC+2)');
  zonas = ['Europe/Madrid (UTC+2)', 'Europe/London (UTC+1)', 'America/Mexico_City (UTC-5)'];
  moneda = signal('Euro (€)');
  monedas = ['Euro (€)', 'Dólar ($)', 'Libra (£)'];
  fmtDate = signal('DD/MM/YYYY');
  fmtDates = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

  // Seguridad
  apiAccess = signal(false);
  sessions: SessionRow[] = [
    { device: 'Chrome · macOS', location: 'Barcelona, ES', time: 'Sesión actual', current: true },
    { device: 'Safari · iPhone', location: 'Barcelona, ES', time: 'Hace 2 horas', current: false },
    { device: 'Firefox · Windows', location: 'Madrid, ES', time: 'Hace 3 días', current: false },
  ];

  integrations = signal<IntegrationRow[]>(INTEGRATIONS);

  toastMessage = signal<string | null>(null);

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2400);
  }

  async toggleNotifEmail(category: NotificationCategory): Promise<void> {
    const current = this.notifPrefs();
    const next = current.map((p) => (p.category === category ? { ...p, emailEnabled: !p.emailEnabled } : p));
    this.notifPrefs.set(next);
    try {
      this.notifPrefs.set(await this.notifications.updatePreferences(next));
    } catch (error) {
      console.error('Error guardando las preferencias de notificación', error);
      this.notifPrefs.set(current);
      this.showToast('No se pudieron guardar las preferencias');
    }
  }

  manageIntegration(integration: IntegrationRow): void {
    if (integration.route) {
      this.router.navigate([integration.route]);
      return;
    }
    this.showToast(integration.toastMsg);
  }

  saveProfile(): void {
    this.editPerfil.set(false);
    this.showToast('Perfil actualizado correctamente');
  }

  private async loadEmpresa(): Promise<void> {
    try {
      this.empresa.set(await this.admins.getOwnAdministrator());
      this.empresaError.set(null);
    } catch (error) {
      console.error('Error cargando los datos de la empresa', error);
      this.empresaError.set('No se pudieron cargar los datos de la empresa.');
    }
  }

  startEditEmpresa(): void {
    const e = this.empresa();
    if (!e) return;
    this.empPhone.set(e.phone ?? '');
    this.empContactName.set(e.contactName ?? '');
    this.empContactEmail.set(e.contactEmail ?? '');
    this.empVatNumber.set(e.vatNumber ?? '');
    this.editEmpresa.set(true);
  }

  async saveEmpresa(): Promise<void> {
    if (this.empContactEmailInvalid()) return;
    this.empresaSaving.set(true);
    try {
      // Vacío = null: borra el dato en vez de dejar una cadena vacía.
      this.empresa.set(await this.admins.updateOwnAdministrator({
        phone: this.empPhone().trim() || null,
        contactName: this.empContactName().trim() || null,
        contactEmail: this.empContactEmail().trim() || null,
        vatNumber: this.empVatNumber().trim() || null,
      }));
      this.editEmpresa.set(false);
      this.showToast('Datos de empresa actualizados');
    } catch (error) {
      console.error('Error guardando los datos de la empresa', error);
      this.showToast('No se pudieron guardar los datos de la empresa');
    } finally {
      this.empresaSaving.set(false);
    }
  }

  // ── Equipo — invitar colegas a la misma gestora (autoservicio) ──────────
  // La invitación de equipo todavía no se envía por email (MailService
  // existe, pero este flujo no lo usa): el enlace se copia y se comparte a
  // mano. No pide CIF — es un dato de la empresa (Administrator), no de la
  // persona invitada.
  teamInviteLink = signal<string | null>(null);
  teamInviteCopied = signal(false);
  teamInviteError = signal<string | null>(null);
  generatingTeamInvite = signal(false);

  async generateTeamInvite(): Promise<void> {
    this.generatingTeamInvite.set(true);
    this.teamInviteError.set(null);
    try {
      const { token } = await this.admins.createTeamInvite();
      this.teamInviteLink.set(`${window.location.origin}/team-invite/${token}`);
      this.teamInviteCopied.set(false);
    } catch (error) {
      console.error('Error generando la invitación de equipo', error);
      this.teamInviteError.set('No se pudo generar el enlace de invitación.');
    } finally {
      this.generatingTeamInvite.set(false);
    }
  }

  async copyTeamInviteLink(): Promise<void> {
    const link = this.teamInviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.teamInviteCopied.set(true);
      setTimeout(() => this.teamInviteCopied.set(false), 2000);
    } catch (error) {
      console.error('Error copiando el enlace', error);
    }
  }

  savePreferences(): void {
    this.showToast('Preferencias guardadas');
  }

  toggleDarkMode(): void {
    this.state.toggleDarkMode();
  }

  toggleApiAccess(): void {
    const next = !this.apiAccess();
    this.apiAccess.set(next);
    this.showToast(next ? 'Acceso API activado — revisa las integraciones' : 'Acceso API desactivado');
  }

  closeSession(): void {
    this.showToast('Sesión cerrada correctamente');
  }

  changePassword(): void {
    this.showToast('Enlace de restablecimiento enviado a tu email');
  }

  deleteAccount(): void {
    this.showToast('Por favor, contacta con soporte para eliminar la cuenta');
  }
}
