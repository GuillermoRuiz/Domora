import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ManagerOverviewService } from '../../core/manager-overview.service';
import { CommunityScopeService } from '../../core/community-scope.service';
import type { MilestoneItem, PendingItem, PerformanceRow } from '../../core/manager-overview.models';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { EstateScopeSelectorComponent } from '../dashboard-b/estate-scope-selector/estate-scope-selector.component';
import { OverviewActivityComponent } from './overview-activity/overview-activity.component';
import { OverviewEconomicComponent } from './overview-economic/overview-economic.component';
import { OverviewKpisComponent } from './overview-kpis/overview-kpis.component';
import { OverviewMilestonesComponent } from './overview-milestones/overview-milestones.component';
import { OverviewPendingComponent } from './overview-pending/overview-pending.component';
import { OverviewPerformanceComponent } from './overview-performance/overview-performance.component';
import { overviewRoute } from './overview-routes';
import { OverviewSection } from './overview-section';

/** Saludo según la hora local. */
export function greeting(hour: number): string {
  return hour < 6 ? 'Buenas noches' : hour < 13 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
}

/**
 * «Vista general» del gestor (rol B): página de inicio. Sin finca elegida en el selector de
 * cabecera agrega todas las comunidades; con una elegida se filtra en el sitio (sin redirigir).
 * No hay refresco automático: los datos se piden al entrar y al cambiar la selección.
 */
@Component({
  selector: 'app-overview-b',
  standalone: true,
  imports: [TopbarComponent, EstateScopeSelectorComponent, IconComponent, OverviewKpisComponent, OverviewPendingComponent, OverviewMilestonesComponent, OverviewEconomicComponent, OverviewActivityComponent, OverviewPerformanceComponent],
  templateUrl: './overview-b.component.html',
  styleUrl: './overview-b.component.scss',
})
export class OverviewBComponent {
  private readonly api = inject(ManagerOverviewService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly communityScope = inject(CommunityScopeService);
  readonly scope = this.communityScope.selected;

  readonly kpis = new OverviewSection((id) => this.api.getKpis(id));
  readonly pending = new OverviewSection((id) => this.api.getPendingToday(id));
  readonly milestones = new OverviewSection((id) => this.api.getMilestones(id));
  readonly economic = new OverviewSection((id) => this.api.getEconomicSummary(id));
  readonly activity = new OverviewSection((id) => this.api.getActivity(id));
  readonly performance = new OverviewSection((id) => this.api.getPerformance(id));

  readonly greeting = computed(() => {
    const first = this.auth.currentUser()?.fullName?.trim().split(/\s+/)[0];
    return `${greeting(new Date().getHours())}${first ? `, ${first}` : ''}`;
  });
  readonly scopeLabel = computed(() => this.scope()?.name ?? 'Todas tus comunidades');

  constructor() {
    effect(() => {
      const id = this.scope()?.id ?? null;
      untracked(() => this.reload(id));
    });
  }

  reload(estateId: string | null): void {
    void this.kpis.load(estateId);
    void this.pending.load(estateId);
    void this.milestones.load(estateId);
    void this.economic.load(estateId);
    void this.activity.load(estateId);
    void this.performance.load(estateId);
  }

  /** Reintento de una sola sección, con la selección actual. */
  retry = (section: OverviewSection<unknown>) => (): void => void section.load(this.scope()?.id ?? null);

  /** Una fila pendiente lleva a la gestión que la resuelve. */
  openPending(item: PendingItem): void {
    const route = overviewRoute(item.kind, item.target.estateId);
    void this.router.navigate(route.commands, route.queryParams ? { queryParams: route.queryParams } : undefined);
  }

  /** Un hito lleva a la gestión existente de su tipo. */
  openMilestone(item: MilestoneItem): void {
    const route = overviewRoute(item.kind, item.target.estateId);
    void this.router.navigate(route.commands, route.queryParams ? { queryParams: route.queryParams } : undefined);
  }

  /** Elegir una comunidad en el ranking equivale a elegirla en el selector de la cabecera (sin navegar). */
  pickEstate(row: PerformanceRow): void {
    this.communityScope.select(row.estateId, row.name);
  }

  /** «Ver todas» lleva al listado de Fincas. */
  openEstates(): void {
    void this.router.navigate(['/b/estates']);
  }
}
