import { Component, inject, signal, effect } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { StateService } from '../../core/state.service';
import { CommunityScopeService } from '../../core/community-scope.service';
import { AccountingNavigationService } from '../../core/accounting-navigation.service';
import { OwnerScopeService } from '../../core/owner-scope.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';

interface NavItem {
  label: string;
  route: string;
  icon: string;
  queryParams?: Record<string, string>;
  /** Not highlighted as active (fallback links that point to another section). */
  inactive?: boolean;
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
  private readonly ownerScope = inject(OwnerScopeService);
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
        { label: 'Mi comunidad', route: '/c/community', icon: 'home' },
      ]},
      { section: 'OPERACIONES', items: [
        { label: 'Incidencias', route: '/c/incidencias', icon: 'wrench' },
        { label: 'Documentación', route: '/c/documentacion', icon: 'file-text' },
        { label: 'Mensajes', route: '/c/messages', icon: 'send' },
        this.propertyTab('Juntas', 'juntas', 'calendar'),
        this.propertyTab('Recibos y pagos', 'receipts', 'card'),
      ]},
      { section: 'SISTEMA', items: [
        { label: 'Mi perfil', route: '/c/settings', icon: 'settings' },
      ]},
    ];
  }

  /** A tab of the owner's selected property; without one it falls back to Mi comunidad. */
  private propertyTab(label: string, tab: string, icon: string): NavItem {
    const propertyId = this.ownerScope.selected()?.id;
    return propertyId
      ? { label, route: `/c/properties/${propertyId}`, queryParams: { tab }, icon }
      : { label, route: '/c/community', icon, inactive: true };
  }

}
