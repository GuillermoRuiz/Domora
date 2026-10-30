import { Injectable, computed, inject, signal, effect } from '@angular/core';
import { Role, Estate, OwnerProperty, AlertItem } from './models';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly auth = inject(AuthService);

  // El rol viene del usuario autenticado (la app sigue siendo de rol único
  // por usuario). `mockRoleOverride` solo existe para el selector visual de
  // rol en desarrollo (environment.mockRoleSwitch) y se ignora en producción.
  private readonly mockRoleOverride = signal<Role | null>(null);
  currentRole = computed<Role>(() => this.mockRoleOverride() ?? this.auth.currentUser()?.role ?? 'B');
  userName = computed(() => this.auth.currentUser()?.fullName ?? '—');
  userRole = computed(() => ({ A: 'Super Usuario', B: 'Administrador', C: 'Propietario' })[this.currentRole()]);

  activeNav = signal<string>('');
  selectedEstate = signal<Estate | null>(null);
  selectedProperty = signal<OwnerProperty | null>(null);
  showAddPropertyModal = signal<boolean>(false);
  /** Cuando se abre el wizard de alta desde el detalle de una finca (rol B/A), lleva el contexto para heredar dirección y omitir el paso de vinculación. */
  addPropertyEstateContext = signal<{ id: string; name: string; address: string; streetNumber?: string; location: string } | null>(null);
  /** Se incrementa cada vez que se crea/borra una propiedad, para que las pantallas que listan "mis fincas" recarguen sin depender de una navegación. */
  propertiesVersion = signal<number>(0);
  /** Invalida los contadores globales sin depender de una navegación. */
  notificationsVersion = signal<number>(0);
  bumpNotifications(): void {
    this.notificationsVersion.update(v => v + 1);
  }
  /** NavigationStatusService carga estos datos una vez por sesión/invalidación. */
  unreadMessagesCount = signal(0);
  notificationsCount = signal(0);
  recentAlerts = signal<AlertItem[]>([]);
  recentAlertsLoaded = signal(false);
  recentAlertsLoading = signal(false);
  alertsCount = computed(() => this.recentAlerts().filter(alert => !alert.read).length);
  // Modo oscuro es el tema por defecto (identidad negro + dorado): solo
  // pasa a claro si el usuario lo eligió explícitamente antes.
  darkMode = signal<boolean>(localStorage.getItem('domora-theme') !== 'light');
  /** Drawer del sidebar en viewport móvil/tablet (ID 27, fase 1) — estado de sesión puro, sin persistencia. */
  sidebarOpen = signal<boolean>(false);

  constructor() {
    effect(() => {
      const dark = this.darkMode();
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      localStorage.setItem('domora-theme', dark ? 'dark' : 'light');
    });
  }

  cycleRole(): void {
    if (!environment.mockRoleSwitch) return;
    const map: Record<Role, Role> = { A: 'B', B: 'C', C: 'A' };
    this.mockRoleOverride.set(map[this.currentRole()]);
  }

  toggleDarkMode(): void {
    this.darkMode.set(!this.darkMode());
  }

  toggleSidebar(): void {
    this.sidebarOpen.update(v => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }
}
