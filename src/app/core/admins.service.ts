import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d, PAY_METHOD_FROM_API, PAY_METHOD_TO_API } from './api-shared';
import { AdminStatus, AdminInvoice, AdminBilling, BillingInterval, PlanTier, PlansCatalog, Administrator, SubscriptionStatus, OwnAdministrator, OwnAdministratorPatch, PendingInvoicesSummary } from './models';

const ADMIN_STATUS_FROM_API: Record<string, AdminStatus> = {
  Activa: 'Activa', Periodo_de_gracia: 'Periodo de gracia', Vencida: 'Vencida', Bloqueada: 'Bloqueada',
};
const ADMIN_STATUS_TO_API: Record<string, string> = {
  'Activa': 'Activa', 'Periodo de gracia': 'Periodo_de_gracia', 'Vencida': 'Vencida', 'Bloqueada': 'Bloqueada',
};

/**
 * Stripe subscription linked to a despacho, as role A sees it in the ficha
 * (GET /admins/:id; never the Stripe customer id). `manualBillingAvailable`
 * is true only while it is dead for good (canceled, incomplete_expired):
 * then «Pasar a facturación manual» may detach it (odd/tasks/role-a-panel.md T14).
 */
export interface AdminStripeSubscription {
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  manualBillingAvailable: boolean;
}

/** A despacho plus its Stripe link; `stripeSubscription` is null when it is billed manually. */
export type AdministratorDetail = Administrator & { stripeSubscription: AdminStripeSubscription | null };

/**
 * Exportada (no solo de uso interno): `PropertiesService.resolvePropertyView`
 * la importa directo desde acá para embeber el admin de una propiedad.
 */
export function mapAdministrator(a: any): AdministratorDetail {
  return {
    ...a,
    status: ADMIN_STATUS_FROM_API[a.status] ?? a.status,
    endDate: d(a.endDate),
    mrr: Number(a.mrr),
    discountPct: Number(a.discountPct ?? 0),
    discountUntil: a.discountUntil ? d(a.discountUntil) : a.discountUntil,
    fincas: a.fincas ?? [],
    billing: a.billing
      ? { ...a.billing, paymentMethod: PAY_METHOD_FROM_API[a.billing.paymentMethod] ?? a.billing.paymentMethod }
      : a.billing,
    invoices: (a.invoices ?? []).map(mapAdminInvoice),
    activity: (a.activity ?? []).map((x: any) => ({ ...x, date: d(x.date) })),
    clientStatus: a.clientStatus,
    paymentStatus: a.paymentStatus,
    pendingInvoices: a.pendingInvoices ? mapPendingInvoices(a.pendingInvoices) : undefined,
    stripeSubscription: a.stripeSubscription
      ? {
          status: a.stripeSubscription.status ?? null,
          currentPeriodEnd: a.stripeSubscription.currentPeriodEnd ? d(a.stripeSubscription.currentPeriodEnd) : null,
          cancelAtPeriodEnd: !!a.stripeSubscription.cancelAtPeriodEnd,
          manualBillingAvailable: !!a.stripeSubscription.manualBillingAvailable,
        }
      : null,
  };
}

function mapPendingInvoices(p: any): PendingInvoicesSummary {
  return {
    count: Number(p.count ?? 0),
    amount: Number(p.amount ?? 0),
    overdueCount: Number(p.overdueCount ?? 0),
    overdueAmount: Number(p.overdueAmount ?? 0),
  };
}

function mapAdminInvoice(i: any): AdminInvoice {
  return {
    id: i.id,
    no: i.no ?? i.invoiceNo,
    date: d(i.date ?? i.issueDate),
    operationDate: d(i.operationDate ?? i.issueDate),
    concept: i.concept ?? '',
    taxBase: Number(i.taxBase ?? 0),
    taxRate: Number(i.taxRate ?? 0),
    taxAmount: Number(i.taxAmount ?? 0),
    total: Number(i.total ?? 0),
    recipientName: i.recipientName ?? '',
    recipientTaxId: i.recipientTaxId ?? '',
    recipientAddress: i.recipientAddress ?? '',
    status: i.status,
  };
}

/** Gestoras (administradoras de fincas) — solo rol A, más el catálogo de planes y la suscripción propia (rol B). */
@Injectable({ providedIn: 'root' })
export class AdminsService {
  private api = inject(ApiClientService);

  async listAdministrators(): Promise<Administrator[]> {
    const admins = await this.api.get<any[]>('/admins');
    return admins.map(mapAdministrator);
  }

  async findAdministratorById(id: string): Promise<AdministratorDetail | null> {
    const a = await this.api.getOrNull<any>(`/admins/${id}`);
    return a ? mapAdministrator(a) : null;
  }

  async createAdministrator(input: { name: string; cif: string; plan: PlanTier; contactName?: string; contactEmail?: string; phone?: string }): Promise<Administrator> {
    const raw = await this.api.post<any>('/admins', input);
    return mapAdministrator(raw);
  }

  /** Este flujo aún no envía email (MailService existe, pero no está enganchado aquí): el link se copia y se comparte a mano. */
  async createAdminInvite(administratorId: string): Promise<{ token: string }> {
    return this.api.post<{ token: string }>('/auth/admin-invites', { administratorId });
  }

  /** La propia empresa de la gestora (rol B): solo los datos que salen en comunicaciones y documentos. */
  getOwnAdministrator(): Promise<OwnAdministrator> {
    return this.api.get<OwnAdministrator>('/admins/me');
  }

  /** Razón social y CIF no viajan: cambiarlos es cambiar de entidad legal y lo hace Domora. */
  updateOwnAdministrator(patch: OwnAdministratorPatch): Promise<OwnAdministrator> {
    return this.api.patch<OwnAdministrator>('/admins/me', patch);
  }

  /** Autoservicio (rol B): invita a un colega a la MISMA gestora — el backend toma el administratorId del propio token de sesión. */
  async createTeamInvite(): Promise<{ token: string }> {
    return this.api.post<{ token: string }>('/auth/team-invites', {});
  }

  async updateAdministrator(id: string, patch: {
    plan?: PlanTier; status?: AdminStatus; usersMax?: number;
    discountPct?: number; discountReason?: string; discountUntil?: string;
    endDate?: string; notes?: string; blockReason?: string;
  }): Promise<Administrator> {
    const body: Record<string, unknown> = { ...patch };
    if (patch.status) body['status'] = ADMIN_STATUS_TO_API[patch.status] ?? patch.status;
    const raw = await this.api.patch<any>(`/admins/${id}`, body);
    return mapAdministrator(raw);
  }

  /**
   * «Pasar a facturación manual» (role A): detaches a dead Stripe subscription.
   * `activate` moves a Vencida despacho back to Activa in the same action;
   * the backend answers 409 while the subscription is still alive.
   */
  async switchToManualBilling(id: string, options: { activate?: boolean; billingInterval?: BillingInterval }): Promise<AdministratorDetail> {
    const raw = await this.api.post<any>(`/admins/${id}/manual-billing`, options);
    return mapAdministrator(raw);
  }

  async upsertAdminBilling(id: string, billing: AdminBilling): Promise<AdminBilling> {
    const raw = await this.api.put<any>(`/admins/${id}/billing`, {
      ...billing,
      paymentMethod: PAY_METHOD_TO_API[billing.paymentMethod] ?? billing.paymentMethod,
    });
    return { ...raw, paymentMethod: PAY_METHOD_FROM_API[raw.paymentMethod] ?? raw.paymentMethod };
  }

  async issueAdminInvoice(id: string): Promise<AdminInvoice> {
    const raw = await this.api.post<any>(`/admins/${id}/invoices`, {});
    return mapAdminInvoice(raw);
  }

  /** PDF de la factura, con el QR de cotejo y la leyenda VERI*FACTU. */
  downloadAdminInvoicePdf(invoiceId: string): Promise<Blob> {
    return this.api.getBlob(`/admins/invoices/${invoiceId}/pdf`);
  }

  async listAdminInvoices(administratorId: string): Promise<AdminInvoice[]> {
    const rows = await this.api.get<any[]>(`/admins/${administratorId}/invoices`);
    return rows.map(mapAdminInvoice);
  }

  /** Vista de la propia suscripción (rol B) — GET /subscriptions/me. */
  async getMySubscription(): Promise<{
    plan: PlanTier; tier: string; status: AdminStatus; blockReason: string | null; mrr: number;
    discountPct: number; endDate: string; usersMax: number; usersActive: number;
    /** Estado real del cobro en Stripe — null si la gestora aún no tiene ninguna suscripción asociada. */
    billing: { status: SubscriptionStatus | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  }> {
    const raw = await this.api.get<any>('/subscriptions/me');
    return {
      plan: raw.plan,
      tier: raw.tier,
      status: ADMIN_STATUS_FROM_API[raw.status] ?? raw.status,
      blockReason: raw.blockReason ?? null,
      mrr: Number(raw.mrr),
      discountPct: Number(raw.discountPct ?? 0),
      endDate: d(raw.endDate),
      usersMax: raw.usersMax,
      usersActive: raw.usersActive,
      billing: raw.billing
        ? {
            status: raw.billing.status ?? null,
            currentPeriodEnd: raw.billing.currentPeriodEnd ? d(raw.billing.currentPeriodEnd) : null,
            cancelAtPeriodEnd: !!raw.billing.cancelAtPeriodEnd,
          }
        : null,
    };
  }

  // ── Facturación por Stripe (checkout/portal/cambios) ────────────────────
  // Todos abren o completan una operación en Stripe; los que devuelven
  // `{ url }` se navegan con `window.location.href` desde el componente,
  // igual que hace el original React — el estado real (plan/usersMax/mrr
  // efectivos) se sincroniza después vía el webhook, no en la respuesta.

  createBillingCheckout(): Promise<{ url: string }> {
    return this.api.post('/billing/checkout', {});
  }

  createSetupPaymentMethodSession(): Promise<{ url: string }> {
    return this.api.post('/billing/setup-payment-method', {});
  }

  openBillingPortal(): Promise<{ url: string }> {
    return this.api.post('/billing/portal', {});
  }

  changePlanBilling(plan: PlanTier): Promise<void> {
    return this.api.post('/billing/change-plan', { plan });
  }

  cancelBillingSubscription(): Promise<void> {
    return this.api.post('/billing/cancel', {});
  }

  async countActiveUsersForAdministrator(administratorId: string): Promise<number> {
    const admin = await this.findAdministratorById(administratorId);
    return admin?.usersActive ?? 0;
  }

  getPlansCatalog(): Promise<PlansCatalog> {
    return this.api.get<PlansCatalog>('/plans');
  }
}
