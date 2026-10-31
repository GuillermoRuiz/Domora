import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ClientHealthService } from '../client-health/client-health.service';
import { UsageService } from '../usage/usage.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { mrrContribution } from '../platform-metrics/mrr';
import {
  nextRenewal,
  upcomingRenewals,
  type Renewal,
  type UpcomingRenewals,
} from './renewals';
import type { CreateFollowUpDto, SetNextActionDto } from './dto/leads.dto';

export interface ClientCommercialRow {
  administratorId: string;
  /** Fecha de alta: when the despacho was created in Domora. */
  signupAt: Date;
  /** Only annual or term contracts (see renewals.ts). */
  nextRenewal: Renewal | null;
  /** Last UTC day any role B user of the despacho used the platform (usage log). */
  lastActiveDay: string | null;
  nextAction: string | null;
  /** YYYY-MM-DD. */
  nextActionAt: string | null;
}

export interface ClientsOverview {
  kpis: {
    /** Despachos that pay now (MRR contribution > 0): same rule as «Clientes activos» in the Vista general. */
    activeClients: number;
    /** Client status «En prueba» (Stripe trialing). */
    inTrial: number;
    renewals: UpcomingRenewals;
    /** From the salud engine (T8): paying despachos at risk. */
    churnRisk: number;
  };
  clients: ClientCommercialRow[];
}

const num = (v: { toString(): string } | number) => Number(v);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What the Clientes screen (odd/tasks/role-a-panel.md S13) needs on top of
 * `GET /admins` (list, contact, plan, MRR, statuses) and
 * `GET /client-health/offices` (salud, «En riesgo», motivo): the commercial
 * KPIs and, per despacho, fecha de alta, próxima renovación, última actividad
 * and próxima acción. Same records as Administradores de fincas.
 */
@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: ClientHealthService,
    private readonly usage: UsageService,
  ) {}

  async overview(now = new Date()): Promise<ClientsOverview> {
    const admins = await this.prisma.administrator.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        mrr: true,
        discountPct: true,
        discountUntil: true,
        deletedAt: true,
        billingInterval: true,
        endDate: true,
        subscription: {
          select: {
            stripeSubscriptionId: true,
            status: true,
            currentPeriodEnd: true,
            cancelAtPeriodEnd: true,
          },
        },
        nextAction: { select: { nextAction: true, nextActionAt: true } },
      },
    });
    const ids = admins.map((a) => a.id);
    const [health, lastActive] = await Promise.all([
      this.health.overview(now),
      this.usage.lastActiveDays(ids),
    ]);

    let activeClients = 0;
    const clients: ClientCommercialRow[] = admins.map((a) => {
      const client = { ...a, mrr: num(a.mrr), discountPct: num(a.discountPct) };
      if (mrrContribution(client, now) > 0) activeClients += 1;
      return {
        administratorId: a.id,
        signupAt: a.createdAt,
        nextRenewal: nextRenewal(client, now),
        lastActiveDay: lastActive.get(a.id) ?? null,
        nextAction: a.nextAction?.nextAction ?? null,
        nextActionAt: a.nextAction?.nextActionAt
          ? dayKey(a.nextAction.nextActionAt)
          : null,
      };
    });

    return {
      kpis: {
        activeClients,
        inTrial: health.offices.filter((o) => o.clientStatus === 'En prueba')
          .length,
        renewals: upcomingRenewals(
          clients.map((c) => c.nextRenewal),
          now,
        ),
        churnRisk: health.churnRisk,
      },
      clients,
    };
  }

  async setNextAction(administratorId: string, dto: SetNextActionDto) {
    await this.assertDespacho(administratorId);
    const nextAction = dto.nextAction?.trim() ? dto.nextAction.trim() : null;
    const nextActionAt = dto.nextActionAt
      ? new Date(dto.nextActionAt.slice(0, 10))
      : null;
    const row = await this.prisma.clientNextAction.upsert({
      where: { administratorId },
      create: { administratorId, nextAction, nextActionAt },
      update: { nextAction, nextActionAt },
    });
    return {
      administratorId,
      nextAction: row.nextAction,
      nextActionAt: row.nextActionAt ? dayKey(row.nextActionAt) : null,
    };
  }

  async followUps(administratorId: string) {
    await this.assertDespacho(administratorId);
    const rows = await this.prisma.commercialFollowUp.findMany({
      where: { administratorId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: { authorUser: { select: { fullName: true } } },
    });
    return rows.map((f) => ({
      id: f.id,
      occurredAt: f.occurredAt,
      text: f.text,
      author: f.authorUser?.fullName ?? 'Sistema',
    }));
  }

  async addFollowUp(
    administratorId: string,
    dto: CreateFollowUpDto,
    user: AuthenticatedUser,
  ) {
    await this.assertDespacho(administratorId);
    const row = await this.prisma.commercialFollowUp.create({
      data: {
        administratorId,
        authorUserId: user.id,
        text: dto.text,
        ...(dto.occurredAt ? { occurredAt: new Date(dto.occurredAt) } : {}),
      },
      include: { authorUser: { select: { fullName: true } } },
    });
    return {
      id: row.id,
      occurredAt: row.occurredAt,
      text: row.text,
      author: row.authorUser?.fullName ?? 'Sistema',
    };
  }

  private async assertDespacho(administratorId: string): Promise<void> {
    const admin = await this.prisma.administrator.findFirst({
      where: { id: administratorId, deletedAt: null },
      select: { id: true },
    });
    if (!admin) throw new NotFoundException('Despacho no encontrado.');
  }
}
