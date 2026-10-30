import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { ToggleComponent } from '../../shared/components/toggle/toggle.component';
import { TwoFactorEnrollmentComponent } from '../../shared/components/two-factor-enrollment/two-factor-enrollment.component';
import { MembershipsMessagingService } from '../../core/memberships-messaging.service';
import { PropertiesService } from '../../core/properties.service';
import { PushSubscriptionService } from '../../core/push-subscription.service';
import { DirectMessagePolicy, DisplayNamePolicy, MembershipSettings, NotificationSetting, PropertyView } from '../../core/models';

import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
interface PropertyOption {
  id: string;
  label: string;
  estateName: string;
}

/** Fila de la tabla de canales — cada `field` apunta a un `notify*` de MembershipSettings. */
interface NotifCategoryRow {
  field: keyof Pick<
    MembershipSettings,
    'notifyIssues' | 'notifyReceipts' | 'notifyCommunications' | 'notifyBookings' | 'notifyDirectMessages'
  >;
  label: string;
}

const NOTIF_CATEGORIES: NotifCategoryRow[] = [
  { field: 'notifyIssues', label: 'Incidencias' },
  { field: 'notifyReceipts', label: 'Recibos y pagos' },
  { field: 'notifyCommunications', label: 'Comunicados, documentos y juntas' },
  { field: 'notifyBookings', label: 'Reservas de zonas comunes' },
  { field: 'notifyDirectMessages', label: 'Mensajes directos de vecinos' },
];

const NOTIF_OPTIONS: { value: NotificationSetting; label: string }[] = [
  { value: 'none', label: 'Ninguna' },
  { value: 'push_only', label: 'Solo push' },
  { value: 'email_only', label: 'Solo email' },
  { value: 'email_push', label: 'Email y push' },
];

const DIRECT_MESSAGE_OPTIONS: { value: DirectMessagePolicy; label: string }[] = [
  { value: 'nobody', label: 'Nadie' },
  { value: 'neighbors', label: 'Vecinos de mi finca' },
  { value: 'anyone_linked', label: 'Cualquier usuario vinculado' },
];

const DISPLAY_NAME_OPTIONS: { value: DisplayNamePolicy; label: string }[] = [
  { value: 'full_name', label: 'Nombre y apellidos' },
  { value: 'alias', label: 'Un alias' },
  { value: 'address', label: 'Mi dirección (portal, piso, puerta…)' },
];

@Component({
  selector: 'app-ajustes-c',
  standalone: true,
  imports: [TopbarComponent, IconComponent, BtnComponent, AvatarComponent, BadgeComponent, ToggleComponent, FormsModule, TwoFactorEnrollmentComponent, SelectDropdownDirective],
  templateUrl: './ajustes-c.component.html',
  styleUrl: './ajustes-c.component.scss'
})
export class AjustesCComponent implements OnInit {
  private membershipsMessaging = inject(MembershipsMessagingService);
  private propertiesSvc = inject(PropertiesService);
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

  editMode = signal(false);
  nombre = signal('Ana Pujol Mas');
  email = signal('ana.pujol@email.com');
  phone = signal('+34 612 345 678');
  nif = signal('12345678Z');

  commercial = signal(false);

  toastMessage = signal<string | null>(null);

  // ── Privacidad y notificaciones por propiedad ───────────────────────────
  notifCategories = NOTIF_CATEGORIES;
  notifOptions = NOTIF_OPTIONS;
  directMessageOptions = DIRECT_MESSAGE_OPTIONS;
  displayNameOptions = DISPLAY_NAME_OPTIONS;
  displayAliasDraft = signal('');

  properties = signal<PropertyOption[]>([]);
  selectedPropertyId = signal<string | null>(null);
  settings = signal<MembershipSettings | null>(null);
  settingsLoading = signal(false);

  hasMultipleProperties = computed(() => this.properties().length > 1);

  selectedProperty = computed(() =>
    this.properties().find(p => p.id === this.selectedPropertyId()) ?? null,
  );

  async ngOnInit(): Promise<void> {
    try {
      // resolvePropertyView (no la membresía en crudo) es lo que trae el
      // nombre de la finca vía JOIN — sin esto el selector no distingue
      // entre propiedades de fincas distintas (ver dashboard-c, mismo
      // patrón). listMembershipsByUser por sí solo no alcanza.
      // Se descartan antes las membresías a propiedades sin finca — no hay
      // "vecinos" frente a quienes configurar esta visibilidad, y evita
      // pedir la vista de propiedades huérfanas que igual se filtrarían.
      const memberships = (await this.membershipsMessaging.listMembershipsByUser())
        .filter(m => !!(m as { property?: { estateId?: string | null } }).property?.estateId);
      const views = await Promise.all(
        memberships.map(m => this.propertiesSvc.resolvePropertyView(m.propertyId)),
      );
      // Sin finca no hay "vecinos" frente a quienes configurar esta
      // visibilidad — se excluyen las propiedades privadas/sin gestora.
      const options: PropertyOption[] = views
        .filter((v): v is PropertyView => v !== null && !!v.estateName)
        .map((v) => ({
          id: v.property.id,
          label: v.nickname,
          estateName: v.estateName!,
        }));
      this.properties.set(options);
      if (options[0]) {
        this.selectedPropertyId.set(options[0].id);
        await this.loadSettings(options[0].id);
      }
    } catch (error) {
      console.error('Error cargando las propiedades del usuario', error);
    }
  }

  async onSelectProperty(propertyId: string): Promise<void> {
    this.selectedPropertyId.set(propertyId);
    await this.loadSettings(propertyId);
  }

  private async loadSettings(propertyId: string): Promise<void> {
    this.settingsLoading.set(true);
    try {
      const settings = await this.membershipsMessaging.getMembershipSettings(propertyId);
      this.settings.set(settings);
      this.displayAliasDraft.set(settings.displayAlias ?? '');
    } catch (error) {
      console.error('Error cargando ajustes de privacidad', error);
      this.settings.set(null);
    } finally {
      this.settingsLoading.set(false);
    }
  }

  async updateSetting(patch: Partial<MembershipSettings>): Promise<void> {
    const propertyId = this.selectedPropertyId();
    const current = this.settings();
    if (!propertyId || !current) return;
    // Actualización optimista, revertida si la API falla.
    this.settings.set({ ...current, ...patch });
    try {
      this.settings.set(await this.membershipsMessaging.updateMembershipSettings(propertyId, patch));
      this.showToast('Ajustes actualizados');
    } catch (error) {
      console.error('Error guardando ajustes', error);
      this.settings.set(current);
      this.showToast('No se pudieron guardar los ajustes');
    }
  }

  toggleBoolean(field: 'visibleInDirectory' | 'showPhoneInDirectory' | 'showEmailInDirectory' | 'visibleInBookings'): void {
    const current = this.settings();
    if (!current) return;
    void this.updateSetting({ [field]: !current[field] });
  }

  setNotifCategory(field: NotifCategoryRow['field'], value: NotificationSetting): void {
    void this.updateSetting({ [field]: value });
  }

  setDirectMessagePolicy(value: DirectMessagePolicy): void {
    void this.updateSetting({ allowDirectMessages: value });
  }

  setDisplayNamePolicy(value: DisplayNamePolicy): void {
    void this.updateSetting({ displayNamePolicy: value });
  }

  saveDisplayAlias(): void {
    const alias = this.displayAliasDraft().trim();
    if (alias === (this.settings()?.displayAlias ?? '')) return;
    void this.updateSetting({ displayAlias: alias });
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2400);
  }

  saveProfile(): void {
    this.editMode.set(false);
    this.showToast('Perfil actualizado');
  }

  changePassword(): void {
    this.showToast('Enlace de cambio de contraseña enviado a tu email');
  }

  changeAccount(): void {
    this.showToast('Función disponible próximamente');
  }

  deleteAccount(): void {
    this.showToast('Por favor, contacta con soporte para eliminar la cuenta');
  }
}
