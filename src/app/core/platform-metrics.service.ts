import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type { AdminActivityType, AttentionItem, PendingInvoicesSummary } from './models';

/** MRR change of a month split by cause (S9); amounts in €/month, all positive. */
export interface MrrMovements {
  new: number;
  expansion: number;
  contraction: number;
  churn: number;
  reactivation: number;
  net: number;
  /** Clients that start paying in the month (new or back): «altas». */
  signups: number;
  /** Clients that stop paying in the month: «bajas». */
  cancellations: number;
}

export interface MrrMonth {
  /** `YYYY-MM`. */
  month: string;
  mrr: number;
  payingClients: number;
  movements: MrrMovements;
}

/** `GET /platform-metrics/mrr` (role A). */
export interface MrrOverview {
  currentMrr: number;
  payingClients: number;
  /** First month with captured data (`YYYY-MM`): there is no history before it. */
  dataSince: string;
  /** Last 12 months, the current one included. */
  months: MrrMonth[];
}

/** Business event of a despacho (`GET /platform-metrics/activity`, role A). */
export interface PlatformEvent {
  id: string;
  type: AdminActivityType;
  title: string;
  occurredAt: string;
  administrator: { id: string; name: string };
}

/** What the Vista general needs from `GET /admins`: trial accounts and Domora's unpaid invoices. */
export interface ClientsSummary {
  trials: number;
  pendingInvoices: PendingInvoicesSummary;
}

const MOVEMENT_KEYS: (keyof MrrMovements)[] = ['new', 'expansion', 'contraction', 'churn', 'reactivation', 'net', 'signups', 'cancellations'];

const round2 = (value: number): number => Math.round(value * 100) / 100;

function mapMonth(raw: any): MrrMonth {
  const movements = {} as MrrMovements;
  for (const key of MOVEMENT_KEYS) movements[key] = Number(raw.movements?.[key] ?? 0);
  return { month: raw.month, mrr: Number(raw.mrr), payingClients: Number(raw.payingClients), movements };
}

/** Domora business metrics for the role A Vista general. */
@Injectable({ providedIn: 'root' })
export class PlatformMetricsService {
  private api = inject(ApiClientService);

  async mrr(): Promise<MrrOverview> {
    const raw = await this.api.get<any>('/platform-metrics/mrr');
    return {
      currentMrr: Number(raw.currentMrr),
      payingClients: Number(raw.payingClients),
      dataSince: raw.dataSince,
      months: (raw.months ?? []).map(mapMonth),
    };
  }

  activity(limit = 10): Promise<PlatformEvent[]> {
    return this.api.get<PlatformEvent[]>('/platform-metrics/activity', { limit });
  }

  attention(): Promise<AttentionItem[]> {
    return this.api.get<AttentionItem[]>('/client-health/attention');
  }

  async clientsSummary(): Promise<ClientsSummary> {
    const admins = await this.api.get<any[]>('/admins');
    const pending: PendingInvoicesSummary = { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 };
    let trials = 0;
    for (const admin of admins) {
      if (admin.clientStatus === 'En prueba') trials++;
      const p = admin.pendingInvoices;
      if (!p) continue;
      pending.count += Number(p.count ?? 0);
      pending.amount += Number(p.amount ?? 0);
      pending.overdueCount += Number(p.overdueCount ?? 0);
      pending.overdueAmount += Number(p.overdueAmount ?? 0);
    }
    pending.amount = round2(pending.amount);
    pending.overdueAmount = round2(pending.overdueAmount);
    return { trials, pendingInvoices: pending };
  }
}
