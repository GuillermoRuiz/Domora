import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { StatCardComponent } from '../../shared/components/stat-card/stat-card.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AdminsService } from '../../core/admins.service';
import { AdminInsightsService } from '../../core/admin-insights.service';
import { LeadsService } from '../../core/leads.service';
import type { Administrator, ClientCommercialRow, ClientStatus, ClientsOverview, Lead, OfficeHealth, PlanTier } from '../../core/models';
import { RiskTagComponent } from '../admin-detail-a/risk-tag/risk-tag.component';
import { AdminInviteDialogComponent } from '../admin-detail-a/invite-dialog/admin-invite-dialog.component';
import { CLIENT_STATUSES, clientStatusVariant, fmtEur, fmtScore } from '../admin-detail-a/admin-labels';
import {
  LEAD_ORIGIN_LABEL,
  LEAD_STATUS_LABEL,
  OPTIONAL_COLUMNS,
  SIGNUP_WINDOWS,
  SORT_OPTIONS,
  buildClientRows,
  filterClients,
  fmtDay,
  isOpenLead,
  leadStatusVariant,
  riskClients,
  sortClients,
  type ClientRow,
  type OptionalColumn,
  type SignupWindow,
  type SortDir,
  type SortKey,
} from './clients-a-table';
import { LeadDialogComponent } from './lead-dialog/lead-dialog.component';
import { ClientDialogComponent } from './client-dialog/client-dialog.component';

type StatusFilter = ClientStatus | 'TODOS';
type PlanFilter = PlanTier | 'TODOS';

const COLUMNS_STORAGE_KEY = 'domora.clients-a.columns';

function readStoredColumns(): OptionalColumn[] {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((c): c is OptionalColumn => OPTIONAL_COLUMNS.some(o => o.key === c)) : [];
  } catch {
    return [];
  }
}

/**
 * Clientes (odd/tasks/role-a-panel.md S13): Domora's commercial relationship
 * with the despachos. The table rows are the same despachos as
 * Administradores de fincas (`GET /admins`) with their salud and commercial
 * data, and a row opens the same ficha 360°. Potential clients live in leads
 * («Nuevas oportunidades») until they convert into a despacho.
 */
@Component({
  selector: 'app-clients-a',
  standalone: true,
  imports: [TopbarComponent, StatCardComponent, BadgeComponent, IconComponent, BtnComponent, RiskTagComponent, AdminInviteDialogComponent, LeadDialogComponent, ClientDialogComponent],
  templateUrl: './clients-a.component.html',
  styleUrl: './clients-a.component.scss',
})
export class ClientsAComponent implements OnInit {
  private adminsSvc = inject(AdminsService);
  private insights = inject(AdminInsightsService);
  private leadsSvc = inject(LeadsService);
  private router = inject(Router);

  /** Reference day for the «fecha de alta» filter; a field so specs can pin it. */
  today = new Date();

  admins = signal<Administrator[]>([]);
  adminsError = signal(false);
  health = signal<Map<string, OfficeHealth>>(new Map());
  atRiskBelow = signal<number | null>(null);
  healthError = signal(false);
  overview = signal<ClientsOverview | null>(null);
  overviewError = signal(false);
  leads = signal<Lead[]>([]);
  leadsError = signal(false);
  loading = signal(true);

  searchQuery = signal('');
  statusFilter = signal<StatusFilter>('TODOS');
  planFilter = signal<PlanFilter>('TODOS');
  signupFilter = signal<SignupWindow>('all');
  sortKey = signal<SortKey>('name');
  sortDir = signal<SortDir>('asc');
  columns = signal<OptionalColumn[]>(readStoredColumns());
  showClosedLeads = signal(false);

  /** null = closed; 'new' = «Nuevo cliente»; otherwise the lead id. */
  leadDialog = signal<string | null>(null);
  clientDialog = signal<ClientRow | null>(null);
  inviteTarget = signal<{ id: string; name: string } | null>(null);
  toastMessage = signal<string | null>(null);

  readonly statusFilters: StatusFilter[] = ['TODOS', ...CLIENT_STATUSES];
  readonly planFilters: PlanFilter[] = ['TODOS', 'BASE', 'STANDARD', 'PREMIUM'];
  readonly signupWindows = SIGNUP_WINDOWS;
  readonly sortOptions = SORT_OPTIONS;
  readonly optionalColumns = OPTIONAL_COLUMNS;
  readonly originLabel = LEAD_ORIGIN_LABEL;
  readonly leadStatusLabel = LEAD_STATUS_LABEL;
  readonly leadStatusVariant = leadStatusVariant;
  readonly clientStatusVariant = clientStatusVariant;
  readonly fmtEur = fmtEur;
  readonly fmtScore = fmtScore;
  readonly fmtDay = fmtDay;

  private commercial = computed(() => new Map<string, ClientCommercialRow>((this.overview()?.clients ?? []).map(c => [c.administratorId, c])));

  rows = computed(() => buildClientRows(this.admins(), this.health(), this.commercial()));

  visibleRows = computed(() =>
    sortClients(
      filterClients(this.rows(), { query: this.searchQuery(), status: this.statusFilter(), plan: this.planFilter(), signup: this.signupFilter() }, this.today),
      this.sortKey(),
      this.sortDir(),
    ),
  );

  visibleMrr = computed(() => this.visibleRows().reduce((s, r) => s + r.admin.mrr, 0));

  atRisk = computed(() => riskClients(this.rows()));

  panelLeads = computed(() => (this.showClosedLeads() ? this.leads() : this.leads().filter(isOpenLead)));

  openLeadCount = computed(() => this.leads().filter(isOpenLead).length);

  kpis = computed(() => {
    const o = this.overview();
    const below = this.atRiskBelow();
    return [
      {
        label: 'Clientes activos',
        value: o ? String(o.kpis.activeClients) : '—',
        icon: 'users',
        info: 'Despachos que pagan ahora: suscripción activa (o con un cobro pendiente de reintento) y clientes con facturación manual al día o en periodo de gracia. Es la misma cifra que en la Vista general.',
      },
      {
        label: 'En prueba',
        value: o ? String(o.kpis.inTrial) : '—',
        icon: 'clock',
        info: 'Despachos con la suscripción en periodo de prueba. No cuentan en el MRR ni en los clientes activos hasta que empiezan a pagar.',
      },
      {
        label: 'Renovaciones próximas (90 días)',
        value: o ? String(o.kpis.renewals.count) : '—',
        sub: o ? `${fmtEur(o.kpis.renewals.amount)} en juego` : undefined,
        icon: 'calendar',
        info: 'Solo contratos anuales o con fecha de fin que renuevan de hoy a 90 días. Importe en juego = MRR actual del cliente × 12, sin IVA y con los descuentos vigentes. Las suscripciones mensuales no renuevan y las que tienen la baja solicitada no cuentan.',
      },
      {
        label: 'Churn risk',
        value: o ? String(o.kpis.churnRisk) : '—',
        icon: 'exclamation',
        info: `Clientes que pagan (Activo o En onboarding) con la salud por debajo de ${below ?? 70}. La salud combina pagos, uso de la plataforma, completitud e incidencias; el motivo es la señal que más resta.`,
      },
    ];
  });

  loadError = computed(() => this.adminsError() || this.healthError() || this.overviewError() || this.leadsError());

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  private async loadAll(): Promise<void> {
    await Promise.all([this.loadAdmins(), this.loadHealth(), this.loadOverview(), this.loadLeads()]);
    this.loading.set(false);
  }

  private async loadAdmins(): Promise<void> {
    try {
      this.admins.set(await this.adminsSvc.listAdministrators());
      this.adminsError.set(false);
    } catch (error) {
      console.error('Error cargando los clientes', error);
      this.adminsError.set(true);
    }
  }

  private async loadHealth(): Promise<void> {
    try {
      const overview = await this.insights.healthOverview();
      this.health.set(new Map(overview.offices.map(o => [o.administratorId, o])));
      this.atRiskBelow.set(overview.atRiskBelow);
      this.healthError.set(false);
    } catch (error) {
      console.error('Error cargando la salud de los clientes', error);
      this.healthError.set(true);
    }
  }

  private async loadOverview(): Promise<void> {
    try {
      this.overview.set(await this.leadsSvc.clientsOverview());
      this.overviewError.set(false);
    } catch (error) {
      console.error('Error cargando los datos comerciales', error);
      this.overview.set(null);
      this.overviewError.set(true);
    }
  }

  private async loadLeads(): Promise<void> {
    try {
      this.leads.set(await this.leadsSvc.listLeads());
      this.leadsError.set(false);
    } catch (error) {
      console.error('Error cargando las oportunidades', error);
      this.leadsError.set(true);
    }
  }

  hasColumn(key: OptionalColumn): boolean {
    return this.columns().includes(key);
  }

  toggleColumn(key: OptionalColumn): void {
    const next = this.hasColumn(key) ? this.columns().filter(c => c !== key) : [...this.columns(), key];
    this.columns.set(next);
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Per-viewer convenience only: the page works without storage.
    }
  }

  columnCount(): number {
    return 8 + this.columns().length;
  }

  setSort(key: SortKey): void {
    this.sortKey.set(key);
  }

  toggleSortDir(): void {
    this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
  }

  /** Same ficha 360° as Administradores de fincas (S13). */
  openClient(administratorId: string): void {
    void this.router.navigate(['/a/admins', administratorId]);
  }

  openNextAction(row: ClientRow, event: Event): void {
    event.stopPropagation();
    this.clientDialog.set(row);
  }

  async onNextActionSaved(): Promise<void> {
    this.clientDialog.set(null);
    await this.loadOverview();
    this.showToast('Próxima acción guardada');
  }

  openLead(id: string): void {
    this.leadDialog.set(id);
  }

  newLead(): void {
    this.leadDialog.set('new');
  }

  async onLeadSaved(): Promise<void> {
    this.leadDialog.set(null);
    await this.loadLeads();
    this.showToast('Oportunidad guardada');
  }

  /** The lead is now a despacho: reload everything and offer its invitation, as «Añadir administrador» does. */
  async onLeadConverted(event: { administratorId: string; name: string }): Promise<void> {
    this.leadDialog.set(null);
    await this.loadAll();
    this.inviteTarget.set({ id: event.administratorId, name: event.name });
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2400);
  }

  planVariant(plan: string): 'primary' | 'default' {
    return plan === 'PREMIUM' ? 'primary' : 'default';
  }

  /** Overdue or due today: highlight the next action. */
  isDue(day: string | null | undefined): boolean {
    return !!day && day <= this.today.toISOString().slice(0, 10);
  }
}
