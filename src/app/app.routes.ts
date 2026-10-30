import { Route, Routes } from '@angular/router';
import { tenantEstateGuard, tenantAccountingGuard } from './core/tenant.guard';
import { roleGuard } from './core/role.guard';
import { roleHomeRedirect } from './core/role-home';
import { communityScopeRedirect } from './core/community-scope.service';
import { legacyCommunityIssueRedirect, legacyOwnerTabRedirect } from './core/legacy-owner-tab-redirect';
import { reportsRoleGuard } from './features/reports/reports.guard';
import { legacyEstateOperationsGuard, operationsRoleGuard } from './features/operations/operations-routing';

/** Role A section that is in the navigation but not specified yet. */
function roleAPlaceholder(path: string, title: string, description: string, icon: string): Route {
  return {
    path,
    data: { title, description, icon },
    loadComponent: () => import('./features/section-placeholder-a/section-placeholder-a.component').then(m => m.SectionPlaceholderAComponent),
  };
}

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./features/register/register.component').then(m => m.RegisterComponent)
  },
  {
    path: 'invite/:token',
    loadComponent: () => import('./features/admin-invite/admin-invite.component').then(m => m.AdminInviteComponent)
  },
  {
    path: 'team-invite/:token',
    loadComponent: () => import('./features/team-invite/team-invite.component').then(m => m.TeamInviteComponent)
  },
  {
    path: 'membership-invite/:token',
    loadComponent: () => import('./features/membership-invite/membership-invite.component').then(m => m.MembershipInviteComponent)
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./features/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent)
  },
  {
    path: 'reset-password/:token',
    loadComponent: () => import('./features/reset-password/reset-password.component').then(m => m.ResetPasswordComponent)
  },
  {
    path: 'privacidad',
    loadComponent: () => import('./features/privacidad/privacidad.component').then(m => m.PrivacidadComponent)
  },
  {
    path: 'aviso-legal',
    loadComponent: () => import('./features/aviso-legal/aviso-legal.component').then(m => m.AvisoLegalComponent)
  },
  {
    path: 'cookies',
    loadComponent: () => import('./features/cookies/cookies.component').then(m => m.CookiesComponent)
  },
  {
    path: 'terminos',
    loadComponent: () => import('./features/terminos/terminos.component').then(m => m.TerminosComponent)
  },
  {
    path: 'wait/:meetingId',
    loadComponent: () => import('./features/waiting-room/waiting-room.component').then(m => m.WaitingRoomComponent)
  },
  {
    path: 'beacon/:meetingId',
    loadComponent: () => import('./features/meeting-beacon/meeting-beacon.component').then(m => m.MeetingBeaconComponent)
  },

  {
    path: '',
    canActivateChild: [roleGuard],
    children: [
      { path: '', redirectTo: roleHomeRedirect, pathMatch: 'full' },

      // Role A
      {
        path: 'a/overview',
        loadComponent: () => import('./features/overview-a/overview-a.component').then(m => m.OverviewAComponent)
      },
      {
        path: 'a/clients',
        loadComponent: () => import('./features/clients-a/clients-a.component').then(m => m.ClientsAComponent)
      },
      roleAPlaceholder('a/billing', 'Facturación y cobros', 'Facturas emitidas por Domora a sus clientes, pagos recibidos, vencimientos, impagos e historial.', 'card'),
      roleAPlaceholder('a/analytics', 'Analítica y adopción', 'Evolución del MRR, captación y bajas, retención, usuarios activos, frecuencia de uso y módulos utilizados.', 'chart'),
      roleAPlaceholder('a/onboarding', 'Onboarding y completitud', 'Seguimiento de la configuración inicial de cada despacho y sus comunidades.', 'check-check'),
      roleAPlaceholder('a/support', 'Soporte e incidencias', 'Tickets que los administradores abren a Domora por problemas técnicos, dudas o solicitudes.', 'help-circle'),
      roleAPlaceholder('a/communities', 'Comunidades', 'Acceso jerárquico a las comunidades gestionadas por los clientes para consultar información operativa y dar soporte.', 'building'),
      roleAPlaceholder('a/users', 'Usuarios y accesos', 'Gestión y supervisión de usuarios, invitaciones, roles, activaciones y permisos de la plataforma.', 'key'),
      roleAPlaceholder('a/audit', 'Seguridad y auditoría', 'Registro de accesos, cambios sensibles, permisos administrativos y acciones realizadas por el equipo Domora.', 'shield'),
      {
        path: 'a/admins',
        loadComponent: () => import('./features/dashboard-a/dashboard-a.component').then(m => m.DashboardAComponent)
      },
      {
        path: 'a/admins/:id',
        loadComponent: () => import('./features/admin-detail-a/admin-detail-a.component').then(m => m.AdminDetailAComponent)
      },
      {
        path: 'a/settings',
        loadComponent: () => import('./features/ajustes-a/ajustes-a.component').then(m => m.AjustesAComponent)
      },
      {
        path: 'a/messages',
        loadComponent: () => import('./features/mensajes/mensajes.component').then(m => m.MensajesComponent)
      },
      {
        path: 'a/notifications',
        loadComponent: () => import('./features/notificaciones/notificaciones.component').then(m => m.NotificacionesComponent)
      },

      // Role B
      {
        path: 'b/overview',
        loadComponent: () => import('./features/overview-b/overview-b.component').then(m => m.OverviewBComponent)
      },
      {
        path: 'b/estates',
        canActivate: [communityScopeRedirect('/b/estates')],
        loadComponent: () => import('./features/dashboard-b/dashboard-b.component').then(m => m.DashboardBComponent)
      },
      {
        path: 'b/estates/:id',
        canActivate: [tenantEstateGuard, legacyEstateOperationsGuard],
        runGuardsAndResolvers: 'paramsOrQueryParamsChange',
        loadComponent: () => import('./features/estate-detail/estate-detail-page.component').then(m => m.EstateDetailPageComponent)
      },
      {
        path: 'b/juntas', canActivate: [operationsRoleGuard], data: { operationsKind: 'meetings' },
        loadComponent: () => import('./features/operations/operations-workspace.component').then(m => m.OperationsWorkspaceComponent)
      },
      {
        path: 'b/incidencias', canActivate: [operationsRoleGuard], data: { operationsKind: 'issues' },
        loadComponent: () => import('./features/operations/operations-workspace.component').then(m => m.OperationsWorkspaceComponent)
      },
      {
        path: 'b/incidencias/:id', canActivate: [operationsRoleGuard],
        loadComponent: () => import('./features/issues/issue-detail-page/issue-detail-page.component').then(m => m.IssueDetailPageComponent)
      },
      {
        path: 'b/tasks',
        loadComponent: () => import('./features/tasks/tasks.component').then(m => m.TasksComponent)
      },
      { path: 'b/requests', pathMatch: 'full', redirectTo: 'b/incidencias' },
      {
        path: 'b/accounting',
        canActivate: [communityScopeRedirect('/b/accounting')],
        loadComponent: () => import('./features/accounting/accounting-dashboard/accounting-dashboard.component').then(m => m.AccountingDashboardComponent)
      },
      {
        path: 'b/accounting/:id',
        canActivate: [tenantAccountingGuard],
        loadComponent: () => import('./features/accounting/accounting-detail/accounting-detail.component').then(m => m.AccountingDetailComponent)
      },
      {
        path: 'b/reports',
        canActivate: [reportsRoleGuard],
        loadComponent: () => import('./features/reports/reports-catalog.component').then(m => m.ReportsCatalogComponent)
      },
      {
        path: 'b/reports/category/:categoryKey',
        canActivate: [reportsRoleGuard],
        loadComponent: () => import('./features/reports/reports-catalog.component').then(m => m.ReportsCatalogComponent)
      },
      {
        path: 'b/reports/view/:reportKey',
        canActivate: [reportsRoleGuard],
        loadComponent: () => import('./features/reports/report-viewer.component').then(m => m.ReportViewerComponent)
      },
      {
        path: 'b/alerts',
        loadComponent: () => import('./features/alertas-b/alertas-b.component').then(m => m.AlertasBComponent)
      },
      {
        path: 'b/settings',
        loadComponent: () => import('./features/ajustes/ajustes.component').then(m => m.AjustesComponent)
      },
      {
        path: 'b/migracion',
        loadComponent: () => import('./features/migracion/migracion.component').then(m => m.MigracionComponent)
      },
      {
        path: 'b/subscription',
        loadComponent: () => import('./features/suscripcion/suscripcion.component').then(m => m.SuscripcionComponent)
      },
      {
        path: 'b/messages',
        loadComponent: () => import('./features/mensajes/mensajes.component').then(m => m.MensajesComponent)
      },
      {
        path: 'b/notifications',
        loadComponent: () => import('./features/notificaciones/notificaciones.component').then(m => m.NotificacionesComponent)
      },

      // Role C
      {
        path: 'c/community', canActivate: [legacyCommunityIssueRedirect],
        loadComponent: () => import('./features/community-c/community-c.component').then(m => m.CommunityCComponent)
      },
      // «Mi comunidad» sustituye a «Mis propiedades» como inicio del propietario; los enlaces antiguos siguen funcionando.
      { path: 'c/properties', pathMatch: 'full', redirectTo: 'c/community' },
      {
        path: 'c/properties/:id',
        canActivate: [legacyOwnerTabRedirect],
        loadComponent: () => import('./features/property-detail/property-detail.component').then(m => m.PropertyDetailComponent)
      },
      {
        path: 'c/activity',
        loadComponent: () => import('./features/activity-c/activity-c.component').then(m => m.ActivityCComponent)
      },
      { path: 'c/requests', pathMatch: 'full', redirectTo: 'c/incidencias' },
      {
        path: 'c/incidencias',
        loadComponent: () => import('./features/incidencias-c/incidencias-c.component').then(m => m.IncidenciasCComponent)
      },
      {
        path: 'c/juntas',
        loadComponent: () => import('./features/juntas-c/juntas-c.component').then(m => m.JuntasCComponent)
      },
      {
        path: 'c/recibos',
        loadComponent: () => import('./features/recibos-c/recibos-c.component').then(m => m.RecibosCComponent)
      },
      {
        path: 'c/documentacion',
        loadComponent: () => import('./features/documentacion-c/documentacion-c.component').then(m => m.DocumentacionCComponent)
      },
      {
        path: 'c/alerts',
        loadComponent: () => import('./features/alertas-c/alertas-c.component').then(m => m.AlertasCComponent)
      },
      {
        path: 'c/settings',
        loadComponent: () => import('./features/ajustes-c/ajustes-c.component').then(m => m.AjustesCComponent)
      },
      {
        path: 'c/messages',
        loadComponent: () => import('./features/mensajes/mensajes.component').then(m => m.MensajesComponent)
      },
      {
        path: 'c/notifications',
        loadComponent: () => import('./features/notificaciones/notificaciones.component').then(m => m.NotificacionesComponent)
      },

      { path: '**', redirectTo: roleHomeRedirect },
    ],
  },
];
