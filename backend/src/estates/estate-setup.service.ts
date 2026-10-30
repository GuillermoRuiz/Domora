import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type SetupStepKey =
  | 'fiscal'
  | 'properties'
  | 'quotas'
  | 'coefficients'
  | 'owners'
  | 'sepa'
  | 'opening'
  | 'linked';
export type SetupStepStatus = 'done' | 'pending' | 'warning';
/** `required` cuenta para "completa"; `recommended` avisa pero no bloquea; `info` solo informa. */
export type SetupStepWeight = 'required' | 'recommended' | 'info';

export interface SetupStep {
  key: SetupStepKey;
  weight: SetupStepWeight;
  status: SetupStepStatus;
  /** Contadores para que el frontend redacte el detalle ("12 de 14 propiedades con cuota"). */
  done?: number;
  total?: number;
}

export interface EstateSetupStatus {
  estateId: string;
  steps: SetupStep[];
  requiredDone: number;
  requiredTotal: number;
  complete: boolean;
  /** Propietarios importados con email y sin cuenta — los que se podrían invitar a la app. */
  invitableOwners: number;
}

/** Tolerancia de la suma de coeficientes: el reparto de una escritura de división horizontal rara vez cuadra al céntimo. */
const COEFFICIENT_TOLERANCE = 0.01;

const LINKED_OWNER = {
  roleType: 'Propietario',
  status: 'linked',
  revokedAt: null,
} as const;

/**
 * Estado de puesta en marcha de una finca, DERIVADO al leer y nunca
 * persistido — mismo criterio que `MeetingQuorumService`: los pasos se
 * completan desde pantallas distintas (editar finca, SEPA, importación,
 * alta de titulares...) y un flag guardado se desincronizaría con la
 * primera edición hecha por otro camino.
 *
 * Un solo camino de cálculo para una o muchas fincas (`computeMany`): el
 * número de consultas es fijo (agregadas por `estateId`), no crece con el
 * número de fincas del panel.
 */
@Injectable()
export class EstateSetupService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(estateId: string): Promise<EstateSetupStatus | null> {
    return (await this.computeMany([estateId])).get(estateId) ?? null;
  }

  /**
   * Resumen para el panel de fincas de una gestora. Las fincas salen de
   * `administratorId` y no del claim `estateIds` del JWT: ese claim solo se
   * recalcula al emitir el token, y el resumen debe incluir una finca
   * recién creada aunque la sesión aún no se haya refrescado.
   */
  async summaryForAdministrator(
    administratorId: string,
  ): Promise<Omit<EstateSetupStatus, 'steps'>[]> {
    const estates = await this.prisma.estate.findMany({
      where: { administratorId, deletedAt: null },
      select: { id: true },
    });
    const statuses = await this.computeMany(estates.map((e) => e.id));
    return [...statuses.values()].map(({ steps, ...summary }) => summary);
  }

  async computeMany(
    estateIds: string[],
  ): Promise<Map<string, EstateSetupStatus>> {
    const result = new Map<string, EstateSetupStatus>();
    if (estateIds.length === 0) return result;

    const inEstates = { estateId: { in: estateIds }, deletedAt: null };
    const [
      estates,
      totals,
      withQuota,
      nullCoefficient,
      withOwner,
      withLinkedOwner,
      invitable,
      openingPosted,
      noPriorBalances,
    ] = await Promise.all([
      this.prisma.estate.findMany({
        where: { id: { in: estateIds }, deletedAt: null },
        // Solo se mira si están informados — el IBAN cifrado nunca se descifra aquí.
        select: {
          id: true,
          cif: true,
          creditorId: true,
          creditorIban: true,
          creditorBic: true,
        },
      }),
      this.prisma.property.groupBy({
        by: ['estateId'],
        where: inEstates,
        _count: { _all: true },
        _sum: { participationQuota: true },
      }),
      this.countByEstate({ ...inEstates, quotaMonthly: { gt: 0 } }),
      this.countByEstate({ ...inEstates, participationQuota: null }),
      this.countByEstate({
        ...inEstates,
        OR: [
          { memberships: { some: LINKED_OWNER } },
          { externalOwners: { some: {} } },
        ],
      }),
      this.countByEstate({ ...inEstates, memberships: { some: LINKED_OWNER } }),
      this.prisma.externalOwner.findMany({
        where: {
          property: inEstates,
          promotedToUserId: null,
          email: { not: null },
        },
        select: { property: { select: { estateId: true } } },
      }),
      // Fase 9 de doc/contabilidad/roadmap-partida-doble.md: el paso se da
      // por hecho con una apertura contabilizada o con "sin saldos
      // previos" confirmado — cualquiera de los dos.
      this.prisma.openingBalanceSet.findMany({
        where: { estateId: { in: estateIds }, status: 'Contabilizado' },
        select: { estateId: true },
      }),
      this.prisma.accountingSettings.findMany({
        where: {
          estateId: { in: estateIds },
          noPriorBalancesConfirmedAt: { not: null },
        },
        select: { estateId: true },
      }),
    ]);

    const openingResolvedEstates = new Set([
      ...openingPosted.map((s) => s.estateId),
      ...noPriorBalances.map((s) => s.estateId),
    ]);

    const invitableByEstate = new Map<string, number>();
    for (const row of invitable) {
      const id = row.property.estateId;
      if (id) invitableByEstate.set(id, (invitableByEstate.get(id) ?? 0) + 1);
    }
    const totalsByEstate = new Map(
      totals.map((t) => [
        t.estateId,
        {
          count: t._count._all,
          coefficientSum: Number(t._sum.participationQuota ?? 0),
        },
      ]),
    );

    for (const estate of estates) {
      const total = totalsByEstate.get(estate.id)?.count ?? 0;
      const coefficientSum = totalsByEstate.get(estate.id)?.coefficientSum ?? 0;
      const quotas = withQuota.get(estate.id) ?? 0;
      const owners = withOwner.get(estate.id) ?? 0;
      const missingCoefficients = nullCoefficient.get(estate.id) ?? 0;
      const sepaFields = [
        estate.creditorId,
        estate.creditorIban,
        estate.creditorBic,
      ].filter(Boolean).length;

      const coefficientsOk =
        total > 0 &&
        missingCoefficients === 0 &&
        Math.abs(coefficientSum - 100) <= COEFFICIENT_TOLERANCE;
      const steps: SetupStep[] = [
        {
          key: 'fiscal',
          weight: 'required',
          status: estate.cif ? 'done' : 'pending',
        },
        {
          key: 'properties',
          weight: 'required',
          status: total > 0 ? 'done' : 'pending',
          done: total,
        },
        {
          key: 'quotas',
          weight: 'required',
          status: total > 0 && quotas === total ? 'done' : 'pending',
          done: quotas,
          total,
        },
        {
          // `required` desde ID 11 (cierre de la tarea): antes era
          // `recommended` y nunca bloqueaba que la finca contara como
          // "lista" — bloqueo BLANDO a propósito: esto no impide guardar
          // una propiedad individual con un coeficiente que rompe la suma
          // (`PropertiesService.update` no valida eso), solo marca la
          // finca como no completa en el checklist mientras la suma no dé
          // 100%. Ver el botón "Recalcular por m²" como la vía rápida de
          // arreglarlo.
          key: 'coefficients',
          weight: 'required',
          status: coefficientsOk ? 'done' : total === 0 ? 'pending' : 'warning',
          done: total - missingCoefficients,
          total,
        },
        {
          key: 'owners',
          weight: 'required',
          status: total > 0 && owners === total ? 'done' : 'pending',
          done: owners,
          total,
        },
        {
          key: 'sepa',
          weight: 'recommended',
          status: sepaFields === 3 ? 'done' : 'pending',
          done: sepaFields,
          total: 3,
        },
        {
          key: 'opening',
          weight: 'recommended',
          status: openingResolvedEstates.has(estate.id) ? 'done' : 'pending',
        },
        {
          key: 'linked',
          weight: 'info',
          status:
            (withLinkedOwner.get(estate.id) ?? 0) > 0 ? 'done' : 'pending',
          done: withLinkedOwner.get(estate.id) ?? 0,
          total,
        },
      ];

      const required = steps.filter((s) => s.weight === 'required');
      const requiredDone = required.filter((s) => s.status === 'done').length;
      result.set(estate.id, {
        estateId: estate.id,
        steps,
        requiredDone,
        requiredTotal: required.length,
        complete: requiredDone === required.length,
        invitableOwners: invitableByEstate.get(estate.id) ?? 0,
      });
    }
    return result;
  }

  private async countByEstate(
    where: Parameters<PrismaService['property']['groupBy']>[0]['where'],
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.property.groupBy({
      by: ['estateId'],
      where,
      _count: { _all: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.estateId) counts.set(row.estateId, row._count._all);
    }
    return counts;
  }
}
