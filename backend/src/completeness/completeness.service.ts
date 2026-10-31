import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminActivityType, type Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  EstateSetupService,
  type SetupStep,
} from '../estates/estate-setup.service';
import {
  completeness,
  officeSetupSteps,
  onboardingComplete,
  stepsPercent,
  type OfficeSetupStep,
} from './office-setup';

export interface OfficeCompleteness {
  administratorId: string;
  name: string;
  /** Percentages 0-100 with one decimal. */
  office: number;
  estates: number;
  total: number;
  estateCount: number;
  /** Every required step done, the despacho's and each estate's (≥1 estate). Not done = «En onboarding» (S6). */
  onboardingComplete: boolean;
  /** Stripe-cancelled despachos (S6 «Cancelado») are listed but left out of the average. */
  includedInAverage: boolean;
}

export interface CompletenessOverview {
  /** KPI «Completitud media»; null when no despacho counts. */
  average: number | null;
  offices: OfficeCompleteness[];
}

export interface EstateCompleteness {
  estateId: string;
  name: string;
  percent: number;
  complete: boolean;
  steps: SetupStep[];
}

/** «Qué falta configurar»: each despacho step and each estate's checklist. */
export interface OfficeCompletenessDetail extends OfficeCompleteness {
  officeSteps: OfficeSetupStep[];
  estateDetails: EstateCompleteness[];
}

const round = (value: number): number => Math.round(value * 10) / 10;

/**
 * Completitud of the despachos (odd/tasks/role-a-panel.md S10): derived on
 * read with a fixed number of queries whatever the number of despachos — one
 * for the despachos (relation counts included), one for their estates and the
 * batched estate checklist of `EstateSetupService.computeMany`.
 */
@Injectable()
export class CompletenessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateSetup: EstateSetupService,
  ) {}

  async overview(): Promise<CompletenessOverview> {
    const offices = (await this.compute({})).map(
      ({ officeSteps, estateDetails, ...row }) => row,
    );
    const counted = offices.filter((o) => o.includedInAverage);
    const average =
      counted.length === 0
        ? null
        : round(counted.reduce((sum, o) => sum + o.total, 0) / counted.length);
    return { average, offices };
  }

  async detail(administratorId: string): Promise<OfficeCompletenessDetail> {
    const [office] = await this.compute({ id: administratorId });
    if (!office) throw new NotFoundException('Despacho no encontrado.');
    return office;
  }

  /**
   * Whether each despacho has every required step done (S6 «En onboarding»),
   * in one batch. Deleted or unknown despachos are absent from the map.
   */
  async onboardingCompleteByOffice(
    administratorIds: string[],
  ): Promise<Map<string, boolean>> {
    if (administratorIds.length === 0) return new Map();
    const offices = await this.compute({ id: { in: administratorIds } });
    return new Map(
      offices.map((o) => [o.administratorId, o.onboardingComplete]),
    );
  }

  /**
   * «Finalización del onboarding» (S11): logged once per despacho, the first
   * night it is complete. Despachos that already have the event are not even
   * computed again; the unique `externalRef` keeps it single under races.
   * `scope` narrows the despachos looked at (tests on a shared database).
   */
  async recordOnboardingCompletions(
    now = new Date(),
    scope: Prisma.AdministratorWhereInput = {},
  ): Promise<number> {
    const pending = await this.compute({
      ...scope,
      activity: { none: { type: AdminActivityType.onboarding_completed } },
    });
    const completed = pending.filter((o) => o.onboardingComplete);
    if (completed.length === 0) return 0;
    const { count } = await this.prisma.adminActivityItem.createMany({
      data: completed.map((o) => ({
        administratorId: o.administratorId,
        type: AdminActivityType.onboarding_completed,
        title: 'Onboarding completado',
        occurredAt: now,
        externalRef: `onboarding-completed:${o.administratorId}`,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  private async compute(
    where: Prisma.AdministratorWhereInput,
  ): Promise<OfficeCompletenessDetail[]> {
    const admins = await this.prisma.administrator.findMany({
      where: { ...where, deletedAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        contactName: true,
        contactEmail: true,
        phone: true,
        billing: {
          select: {
            businessName: true,
            cif: true,
            address: true,
            email: true,
            paymentMethod: true,
            iban: true,
          },
        },
        subscription: { select: { stripeSubscriptionId: true, status: true } },
        primaryUser: {
          select: {
            role: true,
            administratorId: true,
            deletedAt: true,
            totpEnabled: true,
          },
        },
        _count: {
          select: {
            users: { where: { role: 'B', deletedAt: null } },
            teamInvites: { where: { usedAt: { not: null } } },
          },
        },
      },
    });
    if (admins.length === 0) return [];

    const estates = await this.prisma.estate.findMany({
      where: {
        administratorId: { in: admins.map((a) => a.id) },
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, administratorId: true },
    });
    const checklists = await this.estateSetup.computeMany(
      estates.map((e) => e.id),
    );
    const estatesByOffice = new Map<string, EstateCompleteness[]>();
    for (const estate of estates) {
      const status = checklists.get(estate.id);
      if (!status || !estate.administratorId) continue;
      const list = estatesByOffice.get(estate.administratorId) ?? [];
      list.push({
        estateId: estate.id,
        name: estate.name,
        percent: round(stepsPercent(status.steps)),
        complete: status.complete,
        steps: status.steps,
      });
      estatesByOffice.set(estate.administratorId, list);
    }

    return admins.map((admin) => {
      const primary = admin.primaryUser;
      const primaryActive =
        !!primary &&
        primary.deletedAt === null &&
        primary.role === 'B' &&
        primary.administratorId === admin.id;
      const estateDetails = estatesByOffice.get(admin.id) ?? [];
      const officeSteps = officeSetupSteps({
        contactName: admin.contactName,
        contactEmail: admin.contactEmail,
        phone: admin.phone,
        billing: admin.billing,
        subscription: admin.subscription,
        estates: estateDetails.length,
        // The primary user, or whoever stands in for a missing one, is not «team».
        otherActiveUsers: Math.max(0, admin._count.users - 1),
        usedTeamInvites: admin._count.teamInvites,
        primaryTotpEnabled: primaryActive ? primary.totpEnabled : null,
      });
      const estateSteps = estateDetails.map((e) => e.steps);
      const pct = completeness(officeSteps, estateSteps);
      return {
        administratorId: admin.id,
        name: admin.name,
        office: round(pct.office),
        estates: round(pct.estates),
        total: round(pct.total),
        estateCount: estateDetails.length,
        onboardingComplete: onboardingComplete(officeSteps, estateSteps),
        includedInAverage: admin.subscription?.status !== 'canceled',
        officeSteps,
        estateDetails,
      };
    });
  }
}
