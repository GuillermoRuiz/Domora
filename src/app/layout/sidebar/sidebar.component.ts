import { Component, inject, signal, effect } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { StateService } from '../../core/state.service';
import { CommunityScopeService } from '../../core/community-scope.service';
import { AccountingNavigationService } from '../../core/accounting-navigation.service';
import {
  OWNER_DOCUMENTS_ROUTE, OWNER_HOME, OWNER_ISSUES_ROUTE, OWNER_MEETINGS_ROUTE, OWNER_MESSAGES_ROUTE, OWNER_RECEIPTS_ROUTE, OWNER_SETTINGS_ROUTE,
} from '../../core/owner-routes';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  badge?: number;
}
interface NavSection {
  section?: string;
  items: NavItem[];
}

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, BadgeComponent],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss'
})
export class SidebarComponent {
  state = inject(StateService);
  /** Se instancia con el shell para seguir la comunidad de las fichas (/b/estates/:id…) desde el primer momento. */
  private readonly communityScope = inject(CommunityScopeService);
  readonly accountingNavigation = inject(AccountingNavigationService);
  readonly accountingExpanded = signal(false);
  constructor() {
    effect(() => {
      const estateId = this.accountingNavigation.context()?.estate()?.id;
      this.accountingExpanded.set(!!estateId);
    });
  }

  get navSections(): NavSection[] {
    const role = this.state.currentRole();
    if (role === 'A') {
      return [
        { section: 'GENERAL', items: [
          { label: 'Vista general', route: '/a/overview', icon: 'home' },
          { label: 'Administradores de fincas', route: '/a/admins', icon: 'users' },
        ]},
        { section: 'NEGOCIO DOMORA', items: [
          { label: 'Clientes', route: '/a/clients', icon: 'user' },
          { label: 'Facturación y cobros', route: '/a/billing', icon: 'card' },
          { label: 'Analítica y adopción', route: '/a/analytics', icon: 'chart' },
          { label: 'Onboarding y completitud', route: '/a/onboarding', icon: 'check-check' },
        ]},
        { section: 'SUPERVISIÓN DE PLATAFORMA', items: [
          { label: 'Soporte e incidencias', route: '/a/support', icon: 'help-circle' },
          { label: 'Comunidades', route: '/a/communities', icon: 'building' },
          { label: 'Usuarios y accesos', route: '/a/users', icon: 'key' },
        ]},
        { section: 'SISTEMA', items: [
          { label: 'Configuración', route: '/a/settings', icon: 'settings' },
          { label: 'Seguridad y auditoría', route: '/a/audit', icon: 'shield' },
        ]},
      ];
    }
    if (role === 'B') {
      return [
        { section: 'GESTIÓN', items: [
          { label: 'Vista general', route: '/b/overview', icon: 'grid' },
          { label: 'Fincas', route: '/b/estates', icon: 'building' },
          { label: 'Juntas', route: '/b/juntas', icon: 'users' },
          { label: 'Incidencias', route: '/b/incidencias', icon: 'exclamation' },
          { label: 'Tareas', route: '/b/tasks', icon: 'calendar' },
          { label: 'Informes', route: '/b/reports', icon: 'file-text' },
        ]},
        { section: 'FINANZAS', items: [
          { label: 'Contabilidad', route: '/b/accounting', icon: 'chart' },
        ]},
      ];
    }
    // Role C
    return [
      { section: 'GENERAL', items: [
        { label: 'Mi comunidad', route: OWNER_HOME, icon: 'home' },
      ]},
      { section: 'OPERACIONES', items: [
        { label: 'Incidencias', route: OWNER_ISSUES_ROUTE, icon: 'wrench' },
        { label: 'Documentación', route: OWNER_DOCUMENTS_ROUTE, icon: 'file-text' },
        // Mismo contador de no leídos que el botón de mensajes de la barra superior.
        { label: 'Mensajes', route: OWNER_MESSAGES_ROUTE, icon: 'send', badge: this.state.unreadMessagesCount() },
        { label: 'Juntas', route: OWNER_MEETINGS_ROUTE, icon: 'calendar' },
        { label: 'Recibos y pagos', route: OWNER_RECEIPTS_ROUTE, icon: 'card' },
      ]},
      { section: 'SISTEMA', items: [
        { label: 'Mi perfil', route: OWNER_SETTINGS_ROUTE, icon: 'user' },
      ]},
    ];
  }

}
