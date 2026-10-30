import { Injectable } from '@nestjs/common';
import { AdminStatus, SubscriptionStatus } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompletenessService } from '../completeness/completeness.service';
import {
  clientStatus,
  paymentStatus,
  pendingInvoicesSummary,
  type ClientStatus,
  type InvoiceForStatus,
  type PaymentStatus,
  type PendingInvoicesSummary,
} from './client-status';

export interface AdministratorClientStatus {
  clientStatus: ClientStatus;
  paymentStatus: PaymentStatus;
  pendingInvoices: PendingInvoicesSummary;
}

/**
 * Client and payment status of the despachos (S6), shared by the role A list
 * and ficha and the later salud, Clientes and Vista general screens. Batched:
 * one despacho query, one unpaid-invoice query and one completitud batch
 * whatever the number of despachos.
 */
@Injectable()
export class ClientStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly completeness: CompletenessService,
  ) {}

  async forAdministrator(administratorId: string): Promise<AdministratorClientStatus | null> {
    return (await this.forAdministrators([administratorId])).get(administratorId) ?? null;
  }

  /**
   * Deleted despachos are included (Cancelado); unknown ids are simply absent
   * from the map. `onboardingComplete` lets a caller that already computed
   * completitud (salud, T8) pass it in instead of computing it twice.
   */
  async forAdministrators(
    administratorIds: string[],
    onboardingComplete?: Map<string, boolean>,
  ): Promise<Map<string, AdministratorClientStatus>> {
    const result = new Map<string, AdministratorClientStatus>();
    if (administratorIds.length === 0) return result;

    const [admins, invoices] = await Promise.all([
      this.prisma.administrator.findMany({
        where: { id: { in: administratorIds } },
        select: { id: true, status: true, deletedAt: true, subscription: { select: { stripeSubscriptionId: true, status: true } } },
      }),
      this.prisma.adminInvoice.findMany({
        where: { administratorId: { in: administratorIds }, status: { in: ['Pendiente', 'Vencida'] } },
        select: { administratorId: true, status: true, total: true, stripeInvoiceId: true },
      }),
    ]);

    const invoicesByOffice = new Map<string, InvoiceForStatus[]>();
    for (const invoice of invoices) {
      const list = invoicesByOffice.get(invoice.administratorId) ?? [];
      list.push({ status: invoice.status, total: Number(invoice.total), stripe: invoice.stripeInvoiceId !== null });
      invoicesByOffice.set(invoice.administratorId, list);
    }

    const rows = admins.map((admin) => ({
      ...admin,
      // Same reading as the MRR: a status without a subscription id is not a Stripe client.
      stripeStatus: admin.subscription?.stripeSubscriptionId ? admin.subscription.status : null,
    }));

    // Completitud only matters for the despachos that end up Activo / En onboarding.
    const needOnboarding = rows
      .filter((r) => clientStatus({ ...r, onboardingComplete: true }) === 'Activo')
      .map((r) => r.id);
    const onboarding =
      onboardingComplete ??
      (needOnboarding.length > 0 ? await this.completeness.onboardingCompleteByOffice(needOnboarding) : new Map<string, boolean>());

    for (const row of rows) {
      const officeInvoices = invoicesByOffice.get(row.id) ?? [];
      result.set(row.id, {
        clientStatus: clientStatus({
          status: row.status as AdminStatus,
          deletedAt: row.deletedAt,
          stripeStatus: row.stripeStatus as SubscriptionStatus | null,
          onboardingComplete: onboarding.get(row.id) ?? false,
        }),
        paymentStatus: paymentStatus({ status: row.status as AdminStatus, stripeStatus: row.stripeStatus as SubscriptionStatus | null, invoices: officeInvoices }),
        pendingInvoices: pendingInvoicesSummary(officeInvoices),
      });
    }
    return result;
  }
}
