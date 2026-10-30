import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PlanTier } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompletenessService } from '../completeness/completeness.service';
import { ClientStatusService } from '../client-status/client-status.service';
import type { ClientStatus, PaymentStatus } from '../client-status/client-status';
import { UsageService } from '../usage/usage.service';
import { CLIENT_HEALTH_CONFIG, type ClientHealthConfig } from './client-health.config';
import {
  attentionReasons,
  compareAttention,
  isAtRisk,
  observedUsageDays,
  paymentSignal,
  saludIndex,
  supportSignal,
  usageSignal,
  type AttentionReason,
  type SaludMotivo,
  type SignalBreakdown,
} from './client-health';
import { SUPPORT_SIGNAL_SOURCE, type SupportSignalSource } from './support-signal';

const DAY_MS = 86_400_000;

/** Paying client statuses: the only ones the «Churn risk» KPI counts. */
const PAYING: ReadonlySet<ClientStatus> = new Set<ClientStatus>(['Activo', 'En onboarding']);

export interface OfficeUsageFacts {
  activeDays: number;
  activeUsers: number;
  staffUsers: number;
  /** Days of the window in which usage could be recorded (signup / capture start). */
  observedDays: number;
}

export interface OfficeHealth {
  administratorId: string;
  name: string;
  plan: PlanTier;
  createdAt: Date;
  clientStatus: ClientStatus;
  paymentStatus: PaymentStatus;
  /** Completitud total 0-100. */
  completeness: number;
  /** 0-100; null for Cancelado despachos. */
  salud: number | null;
  atRisk: boolean;
  motivo: SaludMotivo | null;
  /** Empty for Cancelado despachos. */
  signals: SignalBreakdown[];
  usage: OfficeUsageFacts;
  /** «Requieren atención» reasons of this despacho, most severe first. */
  attention: AttentionReason[];
}

export interface ClientHealthOverview {
  /** «En riesgo» threshold in use. */
  atRiskBelow: number;
  /** KPI «Churn risk»: at-risk despachos that are paying (Activo / En onboarding). */
  churnRisk: number;
  offices: OfficeHealth[];
}

export interface AttentionItem {
  administratorId: string;
  name: string;
  plan: PlanTier;
  clientStatus: ClientStatus;
  paymentStatus: PaymentStatus;
  completeness: number;
  salud: number | null;
  atRisk: boolean;
  reasons: AttentionReason[];
}

/**
 * Salud, «En riesgo», «Requieren atención» and the «Churn risk» KPI
 * (odd/tasks/role-a-panel.md S14, S7, S13) for role A. Batched: one despacho
 * query, the completitud batch (computed once and handed to the status
 * service), the status batch, one usage summary, one first-capture
 * aggregate, one staff count and one support lookup — whatever the number of
 * despachos.
 */
@Injectable()
export class ClientHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly completeness: CompletenessService,
    private readonly clientStatus: ClientStatusService,
    private readonly usage: UsageService,
    @Inject(SUPPORT_SIGNAL_SOURCE) private readonly support: SupportSignalSource,
    @Inject(CLIENT_HEALTH_CONFIG) private readonly config: ClientHealthConfig,
  ) {}

  async overview(now = new Date()): Promise<ClientHealthOverview> {
    const offices = await this.compute(null, now);
    return {
      atRiskBelow: this.config.atRiskBelow,
      churnRisk: offices.filter((o) => o.atRisk && PAYING.has(o.clientStatus)).length,
      offices,
    };
  }

  async office(administratorId: string, now = new Date()): Promise<OfficeHealth> {
    const [office] = await this.compute(administratorId, now);
    if (!office) throw new NotFoundException('Despacho no encontrado.');
    return office;
  }

  async attention(now = new Date()): Promise<AttentionItem[]> {
    const offices = await this.compute(null, now);
    return offices
      .filter((o) => o.attention.length > 0)
      .map((o) => ({
        administratorId: o.administratorId,
        name: o.name,
        plan: o.plan,
        clientStatus: o.clientStatus,
        paymentStatus: o.paymentStatus,
        completeness: o.completeness,
        salud: o.salud,
        atRisk: o.atRisk,
        reasons: o.attention,
      }))
      .sort(compareAttention);
  }

  /** `administratorId` null = every live despacho. */
  private async compute(administratorId: string | null, now: Date): Promise<OfficeHealth[]> {
    const admins = await this.prisma.administrator.findMany({
      where: administratorId ? { deletedAt: null, id: administratorId } : { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, plan: true, createdAt: true },
    });
    if (admins.length === 0) return [];
    const ids = admins.map((a) => a.id);
    const from = new Date(now.getTime() - (this.config.usage.windowDays - 1) * DAY_MS);

    const [completenessRows, usage, firstCapturedDay, staff, tickets] = await Promise.all([
      administratorId
        ? this.completeness.detail(administratorId).then((row) => [row])
        : this.completeness.overview().then((o) => o.offices),
      this.usage.summary(from, now),
      this.usage.firstCapturedDay(),
      this.prisma.user.groupBy({
        by: ['administratorId'],
        where: { role: 'B', deletedAt: null, administratorId: { in: ids } },
        _count: { _all: true },
      }),
      this.support.seriousOpenTickets(ids),
    ]);

    const completeness = new Map(completenessRows.map((c) => [c.administratorId, c]));
    const onboarding = new Map(ids.map((id) => [id, completeness.get(id)?.onboardingComplete ?? false]));
    const statuses = await this.clientStatus.forAdministrators(ids, onboarding);
    const usageByOffice = new Map(usage.despachos.map((d) => [d.administratorId, d]));
    const staffByOffice = new Map(staff.map((s) => [s.administratorId, s._count._all]));

    const result: OfficeHealth[] = [];
    for (const admin of admins) {
      const status = statuses.get(admin.id);
      if (!status) continue;
      const total = completeness.get(admin.id)?.total ?? 0;
      const onboardingComplete = onboarding.get(admin.id) ?? false;
      const used = usageByOffice.get(admin.id);
      const facts: OfficeUsageFacts = {
        activeDays: used?.activeDays ?? 0,
        activeUsers: used?.activeUsers ?? 0,
        staffUsers: staffByOffice.get(admin.id) ?? 0,
        observedDays: observedUsageDays({ today: now, createdAt: admin.createdAt, firstCapturedDay }, this.config),
      };
      const base = {
        administratorId: admin.id,
        name: admin.name,
        plan: admin.plan,
        createdAt: admin.createdAt,
        clientStatus: status.clientStatus,
        paymentStatus: status.paymentStatus,
        completeness: total,
        usage: facts,
      };

      if (status.clientStatus === 'Cancelado') {
        result.push({ ...base, salud: null, atRisk: false, motivo: null, signals: [], attention: [] });
        continue;
      }

      const seriousTickets = tickets === null ? null : (tickets.get(admin.id) ?? 0);
      const usageScore = usageSignal(facts, this.config);
      const health = saludIndex(
        {
          payment: paymentSignal(status.paymentStatus, this.config),
          usage: usageScore,
          completeness: total,
          support: supportSignal(seriousTickets, this.config),
        },
        this.config,
      );
      result.push({
        ...base,
        salud: health.salud,
        atRisk: isAtRisk(health.salud, status.clientStatus, this.config),
        motivo: health.motivo,
        signals: health.signals,
        attention: attentionReasons(
          {
            clientStatus: status.clientStatus,
            paymentStatus: status.paymentStatus,
            usageScore: usageScore?.score ?? null,
            onboardingComplete,
            createdAt: admin.createdAt,
            seriousTickets,
            now,
          },
          this.config,
        ),
      });
    }
    return result;
  }
}
