import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { StatCardComponent } from '../../shared/components/stat-card/stat-card.component';
import { ProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import type { Administrator, ClientStatus, EstateOnboardingRequest, EstateOnboardingStatus, OfficeHealth, PaymentStatus, PlanTier } from '../../core/models';
import { PropertiesService } from '../../core/properties.service';
import { AdminsService } from '../../core/admins.service';
import { AdminInsightsService } from '../../core/admin-insights.service';
import { RiskTagComponent } from '../admin-detail-a/risk-tag/risk-tag.component';
import { AdminInviteDialogComponent } from '../admin-detail-a/invite-dialog/admin-invite-dialog.component';
import { CLIENT_STATUSES, PAYMENT_STATUSES, clientStatusVariant, fmtEur, fmtPct, fmtScore, paymentStatusVariant } from '../admin-detail-a/admin-labels';

type PageView = 'admins' | 'onboarding';
type PlanFilter = PlanTier | 'TODOS';
type StatusFilter = ClientStatus | 'TODOS';
type PaymentFilter = PaymentStatus | 'TODOS';

// Copy comercial — sin equivalente en el backend (el catálogo real, GET
// /plans, solo describe precios/tramos; esta lista de features es
// puramente descriptiva para la UI de venta).
const PLAN_FIRST_FEATURE: Record<PlanTier, string> = {
  BASE: 'Hasta 25 usuarios',
  STANDARD: 'Hasta 100 usuarios',
  PREMIUM: 'Hasta 200 usuarios',
};

/**
 * Administradores de fincas (odd/tasks/role-a-panel.md S4): every despacho
 * registered in Domora with its client status, payment status, completitud
 * and salud. A row opens its ficha 360° (`/a/admins/:id`).
 */
@Component({
  selector: 'app-dashboard-a',
  standalone: true,
  imports: [TopbarComponent, StatCardComponent, ProgressBarComponent, BadgeComponent, IconComponent, BtnComponent, AvatarComponent, RiskTagComponent, AdminInviteDialogComponent],
  templateUrl: './dashboard-a.component.html',
  styleUrl: './dashboard-a.component.scss'
})
export class DashboardAComponent implements OnInit {
  private data = inject(PropertiesService);
  private adminsSvc = inject(AdminsService);
  private insights = inject(AdminInsightsService);
  private router = inject(Router);

  admins = signal<Administrator[]>([]);
  /** Salud and completitud per despacho; empty when `/client-health/offices` fails (columns show «—»). */
  health = signal<Map<string, OfficeHealth>>(new Map());
  searchQuery = signal('');
  planFilter = signal<PlanFilter>('TODOS');
  statusFilterValue = signal<StatusFilter>('TODOS');
  paymentFilter = signal<PaymentFilter>('TODOS');
  toastMessage = signal<string | null>(null);

  pageView = signal<PageView>('admins');
  onboardingRequests = signal<EstateOnboardingRequest[]>([]);
  pendingOnboardingCount = computed(() => this.onboardingRequests().filter(r => r.status === 'pending').length);

  readonly clientStatusVariant = clientStatusVariant;
  readonly paymentStatusVariant = paymentStatusVariant;
  readonly fmtEur = fmtEur;
  readonly fmtPct = fmtPct;
  readonly fmtScore = fmtScore;

  async ngOnInit(): Promise<void> {
    void this.loadHealth();
    try {
      const [admins, onboardingRequests] = await Promise.all([
        this.adminsSvc.listAdministrators(),
        this.data.listEstateOnboardingRequests(),
      ]);
      this.admins.set(admins);
      this.onboardingRequests.set(onboardingRequests);
    } catch (error) {
      console.error('Error cargando administradores', error);
    }
  }

  private async loadHealth(): Promise<void> {
    try {
      const overview = await this.insights.healthOverview();
      this.health.set(new Map(overview.offices.map(o => [o.administratorId, o])));
    } catch (error) {
      console.error('Error cargando la salud de los despachos', error);
    }
  }

  private async reloadAdmins(): Promise<void> {
    this.admins.set(await this.adminsSvc.listAdministrators());
  }

  onboardingStatusLabel(status: EstateOnboardingStatus): string {
    if (status === 'contacted') return 'Contactada';
    if (status === 'dismissed') return 'Descartada';
    return 'Pendiente';
  }

  onboardingStatusVariant(status: EstateOnboardingStatus): 'green' | 'warning' | 'default' {
    if (status === 'contacted') return 'green';
    if (status === 'dismissed') return 'default';
    return 'warning';
  }

  async resolveOnboarding(id: string, status: 'contacted' | 'dismissed'): Promise<void> {
    try {
      await this.data.resolveEstateOnboardingRequest(id, status);
      this.onboardingRequests.set(await this.data.listEstateOnboardingRequests());
      this.showToast(status === 'contacted' ? 'Solicitud marcada como contactada' : 'Solicitud descartada');
    } catch (error) {
      console.error('Error resolviendo la solicitud', error);
      this.showToast('No se pudo actualizar la solicitud');
    }
  }

  planFilters: PlanFilter[] = ['TODOS', 'BASE', 'STANDARD', 'PREMIUM'];
  statusFilters: StatusFilter[] = ['TODOS', ...CLIENT_STATUSES];
  paymentFilters: PaymentFilter[] = ['TODOS', ...PAYMENT_STATUSES];
  planFirstFeature = PLAN_FIRST_FEATURE;
  planOrder: PlanTier[] = ['BASE', 'STANDARD', 'PREMIUM'];

  // ── KPIs ──────────────────────────────────────────────────────────────
  totalMrr = computed(() => this.admins().reduce((s, a) => s + a.mrr, 0));
  totalAdmins = computed(() => this.admins().length);
  graceCount = computed(() => this.admins().filter(a => a.status === 'Periodo de gracia').length);
  vencidaCount = computed(() => this.admins().filter(a => a.status === 'Vencida').length);

  filtered = computed(() => {
    const q = this.searchQuery().toLowerCase();
    const plan = this.planFilter();
    const status = this.statusFilterValue();
    const payment = this.paymentFilter();
    return this.admins().filter(a => {
      const matchesQuery = !q ||
        a.name.toLowerCase().includes(q) ||
        a.cif.toLowerCase().includes(q) ||
        a.contactName.toLowerCase().includes(q) ||
        a.contactEmail.toLowerCase().includes(q);
      const matchesPlan = plan === 'TODOS' || a.plan === plan;
      const matchesStatus = status === 'TODOS' || a.clientStatus === status;
      const matchesPayment = payment === 'TODOS' || a.paymentStatus === payment;
      return matchesQuery && matchesPlan && matchesStatus && matchesPayment;
    });
  });

  filteredMrr = computed(() => this.filtered().reduce((s, a) => s + a.mrr, 0));

  healthOf(admin: Administrator): OfficeHealth | undefined {
    return this.health().get(admin.id);
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2400);
  }

  /** Opens the ficha 360° of the despacho. */
  openAdmin(admin: Administrator): void {
    void this.router.navigate(['/a/admins', admin.id]);
  }

  avatarBg(idx: number): string {
    return idx % 2 === 0 ? 'var(--color-text)' : 'var(--color-secondary)';
  }

  planVariant(plan: string): 'primary' | 'default' {
    return plan === 'PREMIUM' ? 'primary' : 'default';
  }

  daysRemaining(endDate: string): number {
    if (!endDate) return 0;
    const end = new Date(endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  // ── Modal: Nuevo administrador ───────────────────────────────────────────
  newAdminOpen = signal(false);
  newAdminName = signal('');
  newAdminCif = signal('');
  newAdminEmail = signal('');
  newAdminPhone = signal('');
  newAdminPlan = signal<PlanTier>('BASE');
  /** Despacho whose invitation link is being shown. */
  inviteTarget = signal<{ id: string; name: string } | null>(null);

  openNewAdmin(): void {
    this.newAdminName.set('');
    this.newAdminCif.set('');
    this.newAdminEmail.set('');
    this.newAdminPhone.set('');
    this.newAdminPlan.set('BASE');
    this.newAdminOpen.set(true);
  }

  closeNewAdmin(): void {
    this.newAdminOpen.set(false);
  }

  async submitNewAdmin(): Promise<void> {
    const name = this.newAdminName() || 'Nuevo administrador';
    const cif = this.newAdminCif().trim();
    if (!cif) return; // botón ya deshabilitado sin CIF — segunda barrera
    try {
      const created = await this.adminsSvc.createAdministrator({
        name,
        cif,
        plan: this.newAdminPlan(),
        contactName: name,
        contactEmail: this.newAdminEmail() || undefined,
        phone: this.newAdminPhone() || undefined,
      });
      await this.reloadAdmins();
      this.newAdminOpen.set(false);
      // La empresa ya existe, pero todavía no tiene ningún usuario que
      // pueda usarla — generamos de una vez el enlace de invitación en vez
      // de dejar la promesa vacía de "invitado correctamente".
      this.inviteTarget.set({ id: created.id, name });
    } catch (error: any) {
      console.error('Error creando el administrador', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo crear el administrador.');
    }
  }
}
