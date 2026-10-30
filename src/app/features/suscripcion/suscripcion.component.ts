import { Component, computed, signal, inject, OnInit} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { ToggleComponent } from '../../shared/components/toggle/toggle.component';
import { ProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';
import { EstatesService } from '../../core/estates.service';
import { AccountingService } from '../../core/accounting.service';
import { AdminsService } from '../../core/admins.service';
import { AuthService } from '../../core/auth.service';
import { AdminInvoice, PlanTier, PlansCatalog } from '../../core/models';

type Billing = 'monthly' | 'annual';

interface PlanFeature { label: string; ok: boolean; }
/**
 * Copy comercial por plan — sin equivalente en el backend (fincasMax/
 * propsMax/storageGB/features no se persisten ni se hacen cumplir en
 * ningún lado, a diferencia del precio, que SÍ es dato de facturación
 * real). Mismo criterio que PLAN_FEATURES en dashboard-a.component.ts.
 */
interface PlanCopy {
  id: PlanTier;
  name: string;
  fincasMax: number;
  propsMax: number;
  storageGB: number;
  features: PlanFeature[];
}

interface Plan extends PlanCopy {
  monthly: number;
  annual: number;
}

interface AddOn {
  id: string;
  name: string;
  desc: string;
  price: number;
  unit: string;
  icon: string;
  active: boolean;
}

const PLAN_COPY: PlanCopy[] = [
  {
    id: 'BASE', name: 'Base', fincasMax: 5, propsMax: 100, storageGB: 2,
    features: [
      { label: 'Hasta 5 fincas gestionadas', ok: true },
      { label: 'Contabilidad básica', ok: true },
      { label: 'Remesas SEPA (Cuaderno 19)', ok: true },
      { label: 'Gestión de propiedades', ok: true },
      { label: 'Soporte por email', ok: true },
      { label: 'Firma electrónica', ok: false },
      { label: 'Portal del propietario', ok: false },
      { label: 'API de integración', ok: false },
    ],
  },
  {
    id: 'STANDARD', name: 'Standard', fincasMax: 10, propsMax: 300, storageGB: 5,
    features: [
      { label: 'Hasta 10 fincas gestionadas', ok: true },
      { label: 'Contabilidad completa', ok: true },
      { label: 'Remesas SEPA ilimitadas', ok: true },
      { label: 'Gestión de propiedades', ok: true },
      { label: 'Soporte prioritario por email', ok: true },
      { label: 'Firma electrónica (10/mes)', ok: true },
      { label: 'Portal del propietario', ok: false },
      { label: 'API de integración', ok: false },
    ],
  },
  {
    id: 'PREMIUM', name: 'Premium', fincasMax: 20, propsMax: 500, storageGB: 10,
    features: [
      { label: 'Hasta 20 fincas gestionadas', ok: true },
      { label: 'Contabilidad completa', ok: true },
      { label: 'Remesas SEPA ilimitadas', ok: true },
      { label: 'Gestión de propiedades', ok: true },
      { label: 'Soporte telefónico y email', ok: true },
      { label: 'Firma electrónica ilimitada', ok: true },
      { label: 'Portal del propietario', ok: true },
      { label: 'API de integración', ok: true },
    ],
  },
];

const ADDONS: AddOn[] = [
  { id: 'storage', name: 'Almacenamiento adicional', desc: '+10 GB de documentos, actas e imágenes por bloque', price: 5, unit: '10 GB/mes', icon: 'package', active: false },
  { id: 'sms', name: 'Pack de SMS adicionales', desc: '500 SMS/mes para notificaciones a propietarios', price: 12, unit: '500 SMS/mes', icon: 'mail', active: true },
  { id: 'sla', name: 'Soporte SLA garantizado', desc: 'Respuesta garantizada en menos de 2 horas laborables', price: 30, unit: 'mes', icon: 'key', active: false },
  { id: 'whitelabel', name: 'Portal con marca propia', desc: 'Personaliza el portal del propietario con tu logo y dominio', price: 20, unit: 'mes', icon: 'building', active: false },
];

@Component({
  selector: 'app-suscripcion',
  standalone: true,
  imports: [TopbarComponent, IconComponent, BtnComponent, ToggleComponent, ProgressBarComponent, DecimalPipe],
  templateUrl: './suscripcion.component.html',
  styleUrl: './suscripcion.component.scss'
})
export class SuscripcionComponent implements OnInit {
  private estatesSvc = inject(EstatesService);
  private accounting = inject(AccountingService);
  private adminsSvc = inject(AdminsService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  /** true mientras se espera la respuesta de un endpoint de Stripe (checkout/portal/cambios) — deshabilita los botones para evitar doble clic. */
  billingBusy = signal(false);

  addons = signal<AddOn[]>(ADDONS);
  invoices = signal<AdminInvoice[]>([]);

  /**
   * Precios reales del catálogo (GET /plans) — antes esta pantalla tenía
   * su propia copia hardcodeada (29/49/79 €) que ni siquiera coincidía
   * con el catálogo real usado para facturar (49/129/249 €, ver
   * backend/src/admins/plans.catalog.ts). El "anual −20%" sigue siendo
   * un cálculo local: no existe ciclo de facturación anual real en el
   * backend, es puramente el toggle de marketing que ya existía en la UI.
   */
  private plansCatalog = signal<PlansCatalog | null>(null);
  plans = computed<Plan[]>(() => {
    const catalog = this.plansCatalog();
    return PLAN_COPY.map(copy => {
      const monthly = catalog?.prices[copy.id] ?? 0;
      return { ...copy, monthly, annual: Math.round(monthly * 0.8) };
    });
  });

  currentPlanId = signal<PlanTier>('BASE');
  billing = signal<Billing>('monthly');
  planModal = signal<Plan | null>(null);
  toastMessage = signal<string | null>(null);

  currentPlan = computed(() => this.plans().find(p => p.id === this.currentPlanId()) ?? this.plans()[0]);

  addonTotal = computed(() => this.addons().filter(a => a.active).reduce((s, a) => s + a.price, 0));

  /** MRR real vigente (ya incluye descuentos de soporte aplicados) — no el precio de catálogo sin más. */
  private mySubscription = signal<Awaited<ReturnType<AdminsService['getMySubscription']>> | null>(null);

  basePrice = computed(() => {
    const sub = this.mySubscription();
    const catalogPrice = this.billing() === 'annual' ? this.currentPlan().annual : this.currentPlan().monthly;
    if (!sub) return catalogPrice;
    return this.billing() === 'annual' ? Math.round(sub.mrr * 0.8) : sub.mrr;
  });

  totalMonth = computed(() => this.basePrice() + this.addonTotal());

  /**
   * Prioriza el `currentPeriodEnd` real de Stripe (billingInfo) sobre el
   * `endDate` manual de Administrator: en cuanto una gestora tiene una
   * suscripción de Stripe, `endDate` queda congelado (ningún webhook lo
   * toca) mientras que `currentPeriodEnd` avanza cada ciclo de facturación
   * de verdad — mostrar `endDate` en ese caso sería una fecha obsoleta.
   */
  renewalDate = computed(() => {
    const iso = this.billingInfo()?.currentPeriodEnd ?? this.mySubscription()?.endDate;
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
  });

  subscriptionStatus = computed(() => this.mySubscription()?.status ?? 'Activa');
  blockReason = computed(() => this.mySubscription()?.blockReason ?? null);

  usedFincas = signal(0);
  usedProps = signal(0);
  usedStorageGB = 2.1;
  usedFirmas = 8;

  async ngOnInit(): Promise<void> {
    await this.reload();

    // Vuelta de Stripe Checkout (`?billing=success|canceled`, ver
    // BillingService.successUrl/cancelUrl) — el estado real (plan/usersMax/
    // método de pago) llega por el webhook, no por este parámetro; aquí
    // solo se informa y se limpia la URL para que un refresco de página no
    // repita el toast.
    const billingResult = this.route.snapshot.queryParamMap.get('billing');
    if (billingResult === 'success') {
      this.showToast('Pago procesado. Puede tardar unos segundos en reflejarse aquí.');
      // Recargar sin esperar sería inútil: el webhook casi nunca ha llegado
      // todavía en el instante del redirect, así que este segundo reload()
      // devolvería los mismos datos que el de arriba — 5 peticiones en
      // paralelo tiradas a la basura. El margen le da tiempo real al webhook.
      setTimeout(() => void this.reload(), 3000);
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    } else if (billingResult === 'canceled') {
      this.showToast('Operación cancelada.');
      void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    }
  }

  private async reload(): Promise<void> {
    try {
      const administratorId = this.auth.currentUser()?.administratorId ?? undefined;
      const [estates, summaries, plansCatalog, mySubscription, invoices] = await Promise.all([
        this.estatesSvc.listEstates(),
        this.accounting.listAccountingEstates(),
        this.adminsSvc.getPlansCatalog(),
        this.adminsSvc.getMySubscription(),
        administratorId ? this.adminsSvc.listAdminInvoices(administratorId) : Promise.resolve([]),
      ]);
      this.usedFincas.set(estates.length);
      this.usedProps.set(summaries.reduce((s, f) => s + (f.units || 0), 0));
      this.plansCatalog.set(plansCatalog);
      this.currentPlanId.set(mySubscription.plan);
      this.mySubscription.set(mySubscription);
      this.invoices.set(invoices);
    } catch (error) {
      console.error('Error cargando el uso de la suscripción', error);
    }
  }

  /**
   * null si la gestora todavía no tiene ninguna suscripción de Stripe
   * asociada (p.ej. sigue en facturación manual/transferencia). OJO: sigue
   * siendo NO-nulo tras cancelar (el backend nunca borra
   * `stripeSubscriptionId`, solo cambia `status`) — es a propósito, para
   * poder seguir mostrando "Cancelada" como estado informativo y dar
   * acceso al portal de Stripe (historial de facturas) incluso sin
   * suscripción vigente. Para saber si hay algo "activo" de verdad, usar
   * `hasActiveBilling()`.
   */
  billingInfo = computed(() => this.mySubscription()?.billing ?? null);

  /** A diferencia de `billingInfo()`, aquí una suscripción cancelada cuenta como "no hay" — es el criterio correcto para decidir si mostrar "Configurar pago" o permitir cambiar de plan/cancelar. */
  hasActiveBilling = computed(() => {
    const info = this.billingInfo();
    return !!info && info.status !== 'canceled';
  });

  billingStatusLabel(): string {
    const status = this.billingInfo()?.status;
    const labels: Record<string, string> = {
      active: 'Activa', trialing: 'En periodo de prueba', past_due: 'Pago pendiente',
      canceled: 'Cancelada', incomplete: 'Incompleta', incomplete_expired: 'Incompleta (caducada)',
      unpaid: 'Impagada', paused: 'Pausada',
    };
    return status ? (labels[status] ?? status) : 'Sin método de pago configurado';
  }

  propsWarning = computed(() => this.usedProps() / this.currentPlan().propsMax > 0.7);

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2600);
  }

  setBilling(b: Billing): void {
    this.billing.set(b);
  }

  toggleAddon(id: string): void {
    const updated = this.addons().map(a => a.id === id ? { ...a, active: !a.active } : a);
    this.addons.set(updated);
    const changed = updated.find(a => a.id === id)!;
    this.showToast(changed.active ? `"${changed.name}" activado` : `"${changed.name}" desactivado`);
  }

  selectPlan(plan: Plan): void {
    this.planModal.set(plan);
  }

  closePlanModal(): void {
    this.planModal.set(null);
  }

  /**
   * `POST /billing/change-plan` — `proration_behavior: 'none'` en Stripe
   * significa que NO se cobra nada de más ahora mismo, pero el precio del
   * ítem de la suscripción cambia de inmediato en Stripe (y por tanto
   * también en Domora en cuanto llega el webhook `customer.subscription.
   * updated`, típicamente en segundos) — el cobro nuevo solo se refleja en
   * la SIGUIENTE factura, pero el plan/cupo mostrados en pantalla NO
   * quedan congelados hasta entonces. El toast anterior decía "se
   * aplicará en tu próximo ciclo de facturación", que era falso sobre el
   * plan/cupo (aunque cierto sobre el importe cobrado) — se corrige aquí
   * para no prometer un aplazamiento que no ocurre. Se recarga la
   * suscripción tras el toast porque, aun así, el webhook no es
   * instantáneo dentro de esta misma petición.
   */
  async confirmPlanChange(): Promise<void> {
    const plan = this.planModal();
    if (!plan) return;
    if (!this.hasActiveBilling()) {
      this.showToast('Primero tienes que dar de alta un método de pago.');
      this.planModal.set(null);
      return;
    }
    this.billingBusy.set(true);
    try {
      await this.adminsSvc.changePlanBilling(plan.id);
      this.showToast(`Cambio a plan ${plan.name} solicitado. El nuevo importe se reflejará en tu próxima factura.`);
      this.planModal.set(null);
      await this.reload();
    } catch (error) {
      console.error('Error cambiando de plan', error);
      this.showToast('No se pudo cambiar de plan.');
    } finally {
      this.billingBusy.set(false);
    }
  }

  isUpgrade(plan: Plan): boolean {
    return plan.monthly >= this.currentPlan().monthly;
  }

  async downloadInvoice(invoice: AdminInvoice): Promise<void> {
    try {
      const blob = await this.adminsSvc.downloadAdminInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.no}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando la factura', error);
      this.showToast('No se pudo descargar la factura');
    }
  }

  /**
   * No hay endpoint de cobro por factura individual (fuera de alcance,
   * ver plan): una factura `Pendiente` es la que Stripe ya está
   * intentando cobrar solo (o reintentará) contra la tarjeta guardada. El
   * Portal de cliente es donde Stripe deja pagarla a mano si el cobro
   * automático falló.
   */
  async payInvoice(): Promise<void> {
    await this.manageBillingPortal();
  }

  contactSales(): void {
    this.showToast('Te contactaremos en menos de 24 horas');
  }

  /** Alta inicial de la suscripción — `POST /billing/checkout`, redirige a Stripe Checkout. */
  async startCheckout(): Promise<void> {
    this.billingBusy.set(true);
    try {
      const { url } = await this.adminsSvc.createBillingCheckout();
      window.location.href = url;
    } catch (error: any) {
      console.error('Error abriendo el checkout de Stripe', error);
      // El backend devuelve mensajes concretos y accionables para los dos
      // casos previsibles (falta completar datos de facturación, o ya
      // existe una suscripción activa) — mostrarlos tal cual es más útil
      // que un genérico "no se pudo".
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo iniciar el pago.');
      this.billingBusy.set(false);
    }
  }

  /** Añadir/cambiar tarjeta — `POST /billing/setup-payment-method`, Stripe Checkout modo `setup` (no cobra nada). */
  async addPaymentMethod(): Promise<void> {
    this.billingBusy.set(true);
    try {
      const { url } = await this.adminsSvc.createSetupPaymentMethodSession();
      window.location.href = url;
    } catch (error) {
      console.error('Error abriendo la gestión de método de pago', error);
      this.showToast('No se pudo abrir la gestión de método de pago.');
      this.billingBusy.set(false);
    }
  }

  /** Portal de cliente de Stripe (facturas, tarjeta, recibos) — `POST /billing/portal`. */
  async manageBillingPortal(): Promise<void> {
    if (!this.billingInfo()) {
      this.showToast('Primero tienes que dar de alta un método de pago.');
      return;
    }
    this.billingBusy.set(true);
    try {
      const { url } = await this.adminsSvc.openBillingPortal();
      window.location.href = url;
    } catch (error) {
      console.error('Error abriendo el portal de facturación', error);
      this.showToast('No se pudo abrir el portal de facturación.');
      this.billingBusy.set(false);
    }
  }

  async cancelSubscription(): Promise<void> {
    if (!this.hasActiveBilling()) {
      this.showToast('No tienes ninguna suscripción activa que cancelar.');
      return;
    }
    if (!confirm('¿Cancelar la suscripción? Seguirá activa hasta el final del periodo ya facturado.')) return;
    this.billingBusy.set(true);
    try {
      await this.adminsSvc.cancelBillingSubscription();
      this.showToast('Cancelación programada para el final del periodo actual.');
      await this.reload();
    } catch (error) {
      console.error('Error cancelando la suscripción', error);
      this.showToast('No se pudo cancelar la suscripción.');
    } finally {
      this.billingBusy.set(false);
    }
  }
}
