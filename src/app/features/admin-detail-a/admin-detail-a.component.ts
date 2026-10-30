import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { ProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import type { AdminActivityType, EstateSetupStepKey, AdminPayMethod, AdminStatus, Administrator, BillingInterval, OfficeHealth, PlanTier, PlanUserTier, PlansCatalog } from '../../core/models';
import { AdminsService, type AdministratorDetail } from '../../core/admins.service';
import { AdminInsightsService } from '../../core/admin-insights.service';
import { DespachoContextService } from '../../core/despacho-context.service';
import type { OfficeCompletenessDetail } from '../../core/office-setup.service';
import { RiskTagComponent } from './risk-tag/risk-tag.component';
import { AdminInviteDialogComponent } from './invite-dialog/admin-invite-dialog.component';
import {
  ESTATE_STEP_LABEL, OFFICE_STEP_LABEL, SIGNAL_LABEL, WEIGHT_LABEL,
  clientStatusVariant, fmtEur, fmtPct, fmtScore, paymentStatusVariant,
} from './admin-labels';

type Tab = 'resumen' | 'suscripcion' | 'fincas' | 'facturacion' | 'actividad';
type ExtendMonths = 1 | 3 | 6 | 12;
type LoadState = 'loading' | 'ready' | 'error';

// Copy comercial — sin equivalente en el backend (el catálogo real, GET
// /plans, solo describe precios/tramos; esta lista es descriptiva).
const PLAN_FEATURES: Record<PlanTier, string[]> = {
  BASE: ['Hasta 25 usuarios', '1 finca', 'Soporte por email'],
  STANDARD: ['Hasta 100 usuarios', 'Fincas ilimitadas', 'Soporte prioritario', 'Remesas SEPA'],
  PREMIUM: ['Hasta 200 usuarios', 'Fincas ilimitadas', 'Soporte 24/7', 'Remesas SEPA', 'Gestor de cuenta dedicado'],
};
const EMPTY_TIERS: Record<PlanTier, PlanUserTier[]> = { BASE: [], STANDARD: [], PREMIUM: [] };
const EMPTY_PRICES: Record<PlanTier, number> = { BASE: 0, STANDARD: 0, PREMIUM: 0 };

const ACTIVITY_ICON: Record<AdminActivityType, string> = {
  login: 'key',
  plan_change: 'refresh',
  discount: 'receipt',
  invoice: 'file-text',
  signup: 'plus',
  block: 'door',
  message: 'mail',
  payment_received: 'card',
  cancellation_requested: 'trending-down',
  onboarding_completed: 'check',
  billing_change: 'receipt',
};

const TABS: { key: Tab; label: string }[] = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'suscripcion', label: 'Suscripción' },
  { key: 'fincas', label: 'Fincas' },
  { key: 'facturacion', label: 'Facturación' },
  { key: 'actividad', label: 'Actividad' },
];

/**
 * Ficha 360° of a despacho (odd/tasks/role-a-panel.md S4): header with its
 * client status, payment status and salud; tabs Resumen (contact, contract,
 * «qué falta configurar», salud breakdown, «Requieren atención»),
 * Suscripción (the existing commercial actions), Fincas, Facturación and
 * Actividad. «Ver sus comunidades» enters the despacho context (S1).
 */
@Component({
  selector: 'app-admin-detail-a',
  standalone: true,
  imports: [TopbarComponent, ProgressBarComponent, BadgeComponent, IconComponent, BtnComponent, AvatarComponent, RouterLink, RiskTagComponent, AdminInviteDialogComponent],
  templateUrl: './admin-detail-a.component.html',
  styleUrl: './admin-detail-a.component.scss',
})
export class AdminDetailAComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private adminsSvc = inject(AdminsService);
  private insights = inject(AdminInsightsService);
  private despachoContext = inject(DespachoContextService);

  readonly tabs = TABS;
  readonly planFeatures = PLAN_FEATURES;
  readonly planOrder: PlanTier[] = ['BASE', 'STANDARD', 'PREMIUM'];
  readonly clientStatusVariant = clientStatusVariant;
  readonly paymentStatusVariant = paymentStatusVariant;
  readonly fmtEur = fmtEur;
  readonly fmtPct = fmtPct;
  readonly fmtScore = fmtScore;
  readonly officeStepLabel = OFFICE_STEP_LABEL;
  readonly weightLabel = WEIGHT_LABEL;
  readonly signalLabel = SIGNAL_LABEL;

  private id = '';
  state = signal<LoadState>('loading');
  admin = signal<AdministratorDetail | null>(null);
  /** Linked Stripe subscription; null when the despacho is billed manually. */
  stripeSubscription = computed(() => this.admin()?.stripeSubscription ?? null);
  health = signal<OfficeHealth | null>(null);
  healthState = signal<LoadState>('loading');
  completeness = signal<OfficeCompletenessDetail | null>(null);
  completenessState = signal<LoadState>('loading');
  plansCatalog = signal<PlansCatalog | null>(null);
  planPrices = computed(() => this.plansCatalog()?.prices ?? EMPTY_PRICES);
  planTiers = computed(() => this.plansCatalog()?.tiers ?? EMPTY_TIERS);

  tab = signal<Tab>('resumen');
  toastMessage = signal<string | null>(null);
  inviteOpen = signal(false);

  /** Despacho steps that count for completitud and are not done yet. */
  pendingOfficeSteps = computed(() =>
    (this.completeness()?.officeSteps ?? []).filter(s => s.weight !== 'info' && s.status !== 'done'));

  /** Estates with at least one counting step still to do, each with those steps. */
  pendingEstates = computed(() =>
    (this.completeness()?.estateDetails ?? [])
      .map(e => ({ ...e, pending: e.steps.filter(s => s.weight !== 'info' && s.status !== 'done') }))
      .filter(e => e.pending.length > 0));

  async ngOnInit(): Promise<void> {
    this.id = this.route.snapshot.paramMap.get('id') ?? '';
    // `?tab=facturacion` opens a tab directly (e.g. «Ver facturación» in «Requieren atención»).
    const requestedTab = this.route.snapshot.queryParamMap?.get('tab');
    const initialTab = TABS.find((t) => t.key === requestedTab);
    if (initialTab) this.tab.set(initialTab.key);
    void this.loadHealth();
    void this.loadCompleteness();
    try {
      const [admin, catalog] = await Promise.all([
        this.adminsSvc.findAdministratorById(this.id),
        this.adminsSvc.getPlansCatalog().catch(() => null),
      ]);
      this.admin.set(admin);
      this.plansCatalog.set(catalog);
      this.state.set(admin ? 'ready' : 'error');
      this.notesDraft.set(admin?.notes ?? '');
    } catch (error) {
      console.error('Error cargando el administrador', error);
      this.state.set('error');
    }
  }

  private async loadHealth(): Promise<void> {
    try {
      this.health.set(await this.insights.officeHealth(this.id));
      this.healthState.set('ready');
    } catch (error) {
      console.error('Error cargando la salud del despacho', error);
      this.healthState.set('error');
    }
  }

  private async loadCompleteness(): Promise<void> {
    try {
      this.completeness.set(await this.insights.officeCompleteness(this.id));
      this.completenessState.set('ready');
    } catch (error) {
      console.error('Error cargando la completitud del despacho', error);
      this.completenessState.set('error');
    }
  }

  /** After an action: the despacho and its derived statuses (salud depends on payment). */
  private async reload(): Promise<void> {
    const [admin] = await Promise.all([this.adminsSvc.findAdministratorById(this.id), this.loadHealth()]);
    if (admin) this.admin.set(admin);
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2400);
  }

  /** Enters the despacho: role B screens reused by role A scope to it (S1). */
  viewCommunities(path = '/b/estates'): void {
    const admin = this.admin();
    if (!admin) return;
    this.despachoContext.select({ id: admin.id, name: admin.name });
    void this.router.navigateByUrl(path);
  }

  subscriptionStatusVariant(status: AdminStatus): 'green' | 'warning' | 'error' | 'default' {
    if (status === 'Activa') return 'green';
    if (status === 'Periodo de gracia') return 'warning';
    if (status === 'Vencida' || status === 'Bloqueada') return 'error';
    return 'default';
  }

  invoiceVariant(status: string): 'green' | 'warning' | 'error' {
    if (status === 'Pagada') return 'green';
    return status === 'Vencida' ? 'error' : 'warning';
  }

  estateStepName(key: string): string {
    return ESTATE_STEP_LABEL[key as EstateSetupStepKey] ?? key;
  }

  /** Salud points a signal takes away: 3 → «−3», 0 → «0». */
  fmtDeduction(n: number): string {
    return n > 0 ? '−' + n.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '0';
  }

  activityIcon(type: AdminActivityType): string {
    return ACTIVITY_ICON[type] || 'file';
  }

  netPrice(a: Administrator): number {
    return this.planPrices()[a.plan] * (1 - a.discountPct / 100);
  }

  annualSavings(a: Administrator): number {
    return (this.planPrices()[a.plan] - this.netPrice(a)) * 12;
  }

  daysRemaining(endDate: string): number {
    if (!endDate) return 0;
    const end = new Date(endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.round((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  private errorMessage(error: any, fallback: string): string {
    const msg = error?.error?.message;
    return typeof msg === 'string' ? msg : fallback;
  }

  // ── Notas internas ───────────────────────────────────────────────────────
  notesDraft = signal('');
  editingNotes = signal(false);

  async saveNotes(): Promise<void> {
    try {
      await this.adminsSvc.updateAdministrator(this.id, { notes: this.notesDraft() });
      await this.reload();
      this.editingNotes.set(false);
      this.showToast('Notas actualizadas');
    } catch (error) {
      console.error('Error guardando las notas', error);
      this.showToast('No se pudieron guardar las notas');
    }
  }

  // ── Modal: Aplicar descuento ─────────────────────────────────────────────
  discountModalOpen = signal(false);
  discountPctDraft = signal(0);
  discountDuration = signal<'1m' | '3m' | '6m' | '12m'>('6m');
  discountReasonDraft = signal('');

  openDiscountModal(): void {
    this.discountPctDraft.set(this.admin()?.discountPct ?? 0);
    this.discountDuration.set('6m');
    this.discountReasonDraft.set('');
    this.discountModalOpen.set(true);
  }

  discountPreviewPrice = computed(() => {
    const admin = this.admin();
    return admin ? this.planPrices()[admin.plan] * (1 - this.discountPctDraft() / 100) : 0;
  });

  private discountUntilFromDuration(): string {
    const months = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }[this.discountDuration()];
    const until = new Date();
    until.setMonth(until.getMonth() + months);
    return until.toISOString().slice(0, 10);
  }

  async applyDiscount(): Promise<void> {
    try {
      await this.adminsSvc.updateAdministrator(this.id, {
        discountPct: this.discountPctDraft(),
        discountReason: this.discountReasonDraft() || undefined,
        discountUntil: this.discountUntilFromDuration(),
      });
      await this.reload();
      this.showToast('Descuento aplicado correctamente');
      this.discountModalOpen.set(false);
    } catch (error) {
      console.error('Error aplicando el descuento', error);
      this.showToast(this.errorMessage(error, 'No se pudo aplicar el descuento.'));
    }
  }

  // ── Modal: Ampliar usuarios ──────────────────────────────────────────────
  expandUsersOpen = signal(false);
  expandUsersTier = signal(0);
  tiersForAdmin = computed(() => {
    const admin = this.admin();
    return admin ? this.planTiers()[admin.plan] : [];
  });

  openExpandUsers(): void {
    this.expandUsersTier.set(0);
    this.expandUsersOpen.set(true);
  }

  async applyExpandUsers(): Promise<void> {
    const tier = this.tiersForAdmin()[this.expandUsersTier()];
    if (!tier) return;
    try {
      await this.adminsSvc.updateAdministrator(this.id, { usersMax: tier.max });
      await this.reload();
      this.showToast(`Límite de usuarios ampliado a ${tier.max}`);
      this.expandUsersOpen.set(false);
    } catch (error) {
      console.error('Error ampliando el límite de usuarios', error);
      this.showToast(this.errorMessage(error, 'No se pudo ampliar el límite de usuarios.'));
    }
  }

  // ── Modal: Cambiar plan ──────────────────────────────────────────────────
  // TODO(backend): no hay soporte para diferir el cambio al próximo ciclo
  // (requeriría un job programado) — el backend siempre aplica el cambio
  // de plan de inmediato. `changePlanTiming` solo afecta el texto del toast.
  changePlanOpen = signal(false);
  changePlanTarget = signal<PlanTier>('BASE');
  changePlanTiming = signal<'inmediato' | 'proximo'>('proximo');

  openChangePlan(): void {
    this.changePlanTarget.set(this.admin()?.plan ?? 'BASE');
    this.changePlanTiming.set('proximo');
    this.changePlanOpen.set(true);
  }

  async applyChangePlan(): Promise<void> {
    const plan = this.changePlanTarget();
    try {
      await this.adminsSvc.updateAdministrator(this.id, { plan });
      await this.reload();
      this.showToast(`Plan cambiado a ${plan} (${this.changePlanTiming() === 'inmediato' ? 'efecto inmediato' : 'próximo ciclo'})`);
      this.changePlanOpen.set(false);
    } catch (error) {
      console.error('Error cambiando el plan', error);
      this.showToast(this.errorMessage(error, 'No se pudo cambiar el plan.'));
    }
  }

  // ── Modal: Extender suscripción ──────────────────────────────────────────
  extendOpen = signal(false);
  extendMonths = signal<ExtendMonths>(1);
  readonly extendOptions: ExtendMonths[] = [1, 3, 6, 12];

  openExtend(): void {
    this.extendMonths.set(1);
    this.extendOpen.set(true);
  }

  private extendedDateIso = computed(() => {
    const admin = this.admin();
    if (!admin?.endDate) return '';
    const base = new Date(admin.endDate);
    base.setMonth(base.getMonth() + this.extendMonths());
    return base.toISOString().slice(0, 10);
  });

  extendedDate = computed(() => {
    const iso = this.extendedDateIso();
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
  });

  async applyExtend(): Promise<void> {
    const newDate = this.extendedDateIso();
    const displayDate = this.extendedDate();
    if (!newDate) return;
    try {
      await this.adminsSvc.updateAdministrator(this.id, { endDate: newDate, status: 'Activa' });
      await this.reload();
      this.showToast(`Suscripción extendida hasta ${displayDate}`);
      this.extendOpen.set(false);
    } catch (error) {
      console.error('Error extendiendo la suscripción', error);
      this.showToast('No se pudo extender la suscripción');
    }
  }

  // ── Modal: Modificar facturación ─────────────────────────────────────────
  billingModalOpen = signal(false);
  billingBusinessName = signal('');
  billingCif = signal('');
  billingAddress = signal('');
  billingEmail = signal('');
  billingPayMethod = signal<AdminPayMethod>('Domiciliación');
  billingIban = signal('');

  openBillingModal(): void {
    const admin = this.admin();
    if (!admin) return;
    // billing es 1:1 opcional — todavía no existe hasta que se guarda por primera vez.
    const billing = admin.billing;
    this.billingBusinessName.set(billing?.businessName ?? admin.name);
    this.billingCif.set(billing?.cif ?? admin.cif);
    this.billingAddress.set(billing?.address ?? '');
    this.billingEmail.set(billing?.email ?? admin.contactEmail ?? '');
    this.billingPayMethod.set(billing?.paymentMethod ?? 'Transferencia');
    this.billingIban.set(billing?.iban ?? '');
    this.billingModalOpen.set(true);
  }

  async saveBilling(): Promise<void> {
    try {
      await this.adminsSvc.upsertAdminBilling(this.id, {
        businessName: this.billingBusinessName(),
        cif: this.billingCif(),
        address: this.billingAddress(),
        email: this.billingEmail(),
        paymentMethod: this.billingPayMethod(),
        iban: this.billingIban(),
      });
      // Billing data and payment method are setup steps: completitud changes too.
      await Promise.all([this.reload(), this.loadCompleteness()]);
      this.showToast('Datos de facturación actualizados');
      this.billingModalOpen.set(false);
    } catch (error) {
      console.error('Error guardando la facturación', error);
      this.showToast('No se pudieron guardar los datos de facturación');
    }
  }

  // ── Modal: Bloquear / Desbloquear ────────────────────────────────────────
  blockModalOpen = signal(false);
  blockReasonDraft = signal('');
  blockConfirmed = signal(false);

  openBlockModal(): void {
    this.blockReasonDraft.set('');
    this.blockConfirmed.set(false);
    this.blockModalOpen.set(true);
  }

  async applyBlockToggle(): Promise<void> {
    const admin = this.admin();
    if (!admin) return;
    const blocking = admin.status !== 'Bloqueada';
    try {
      await this.adminsSvc.updateAdministrator(admin.id, {
        status: blocking ? 'Bloqueada' : 'Activa',
        blockReason: blocking ? this.blockReasonDraft() : undefined,
      });
      await this.reload();
      this.showToast(blocking ? 'Cuenta bloqueada correctamente' : 'Cuenta desbloqueada correctamente');
      this.blockModalOpen.set(false);
    } catch (error) {
      console.error('Error cambiando el estado de bloqueo', error);
      this.showToast('No se pudo cambiar el estado de la cuenta');
    }
  }

  // ── Modal: Pasar a facturación manual (T14) ─────────────────────────────
  // Only offered while the Stripe subscription is dead (`manualBillingAvailable`):
  // the backend detaches it so client status, MRR and completitud read the
  // despacho as manually billed, and refuses (409) a live one.
  manualBillingOpen = signal(false);
  manualBillingActivate = signal(true);
  manualBillingInterval = signal<BillingInterval>('month');
  manualBillingSaving = signal(false);

  /** «cancelada» (Stripe canceled) or «caducada» (incomplete_expired: the first payment never happened). */
  deadStripeLabel = computed(() => (this.stripeSubscription()?.status === 'canceled' ? 'cancelada' : 'caducada'));

  openManualBilling(): void {
    const admin = this.admin();
    if (!admin) return;
    this.manualBillingActivate.set(admin.status === 'Vencida');
    this.manualBillingInterval.set(admin.billingInterval ?? 'month');
    this.manualBillingOpen.set(true);
  }

  async applyManualBilling(): Promise<void> {
    const admin = this.admin();
    if (!admin || this.manualBillingSaving()) return;
    // Only what changes travels: the activity entry then mentions just that.
    const options: { activate?: boolean; billingInterval?: BillingInterval } = {};
    if (admin.status === 'Vencida' && this.manualBillingActivate()) options.activate = true;
    if (this.manualBillingInterval() !== admin.billingInterval) options.billingInterval = this.manualBillingInterval();
    this.manualBillingSaving.set(true);
    try {
      this.admin.set(await this.adminsSvc.switchToManualBilling(this.id, options));
      // Salud reads the payment status and completitud whether it counts in the average.
      await Promise.all([this.loadHealth(), this.loadCompleteness()]);
      this.manualBillingOpen.set(false);
      this.showToast('Despacho pasado a facturación manual');
    } catch (error) {
      console.error('Error pasando a facturación manual', error);
      this.showToast(this.errorMessage(error, 'No se pudo pasar a facturación manual.'));
    } finally {
      this.manualBillingSaving.set(false);
    }
  }

  // ── Modal: Enviar mensaje ────────────────────────────────────────────────
  messageModalOpen = signal(false);
  messageChannel = signal<'email' | 'sms' | 'inapp'>('email');
  messagePriority = signal<'normal' | 'urgente'>('normal');
  messageBody = signal('');

  openMessageModal(): void {
    this.messageChannel.set('email');
    this.messagePriority.set('normal');
    this.messageBody.set('');
    this.messageModalOpen.set(true);
  }

  /**
   * TODO(backend): no existe ningún canal de envío (email/SMS/in-app) para
   * mensajes de soporte a gestoras. Honesto: no hace nada real todavía.
   */
  sendMessage(): void {
    this.showToast('El envío de mensajes no está disponible todavía');
    this.messageModalOpen.set(false);
  }
}
