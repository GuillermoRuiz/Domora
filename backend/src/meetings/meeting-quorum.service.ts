import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Propiedades presentes en una junta: con asistencia registrada o representadas
 * por una delegación vigente (art. 15.1 LPH — el representante ejerce la
 * presencia y el voto del titular, aunque no tenga cuenta en Domora).
 */
export async function listPresentPropertyIds(prisma: PrismaService, meetingId: string): Promise<Set<string>> {
  const [attendance, delegations] = await Promise.all([
    prisma.meetingAttendance.findMany({ where: { meetingId }, distinct: ['propertyId'], select: { propertyId: true } }),
    prisma.meetingVoteDelegation.findMany({
      where: { meetingId, revokedAt: null },
      distinct: ['propertyId'],
      select: { propertyId: true },
    }),
  ]);
  return new Set([...attendance, ...delegations].map((row) => row.propertyId));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convocatoria en la que se constituye (o se constituyó) la junta. */
export type ConvocationCall = 'primera' | 'segunda';

/** De dónde sale la convocatoria usada: lo confirmado por la gestora o una deducción. */
export type ConvocationSource = 'explicit' | 'confirmed' | 'at' | 'now' | 'celebratedAt' | 'scheduledAt2';

export interface QuorumResult {
  convocatoria: ConvocationCall;
  /** Cómo se ha determinado `convocatoria`. Solo `explicit` y `confirmed` son datos confirmados. */
  convocatoriaSource: ConvocationSource;
  /** Art. 16 LPH: en segunda convocatoria no hay quórum exigible. */
  quorumRequired: boolean;
  quorumMet: boolean;
  owners: { present: number; total: number; percent: number };
  quota: { present: number; total: number; percent: number };
  /** Propiedades del censo sin coeficiente asignado — no cuentan en el % de cuotas; aviso de calidad de datos. */
  missingParticipationQuotaCount: number;
  attendingProperties: {
    propertyId: string;
    ref: string | null;
    participationQuota: string | null;
    attendeeNames: string[];
  }[];
}

/**
 * Convocatoria que rige una junta. Orden de prioridad:
 *  1. la indicada expresamente (p. ej. al congelar el acta);
 *  2. la que la gestora confirmó (`Meeting.effectiveConvocation`);
 *  3. una junta convocada y aún en curso: por la hora indicada (`at`) o la actual;
 *  4. una junta ya cerrada SIN confirmación: por el instante en que se marcó como celebrada
 *     (o, a falta de él, la 2ª convocatoria). Es una deducción, no un dato confirmado.
 * Una junta histórica nunca depende de la hora actual.
 */
export function resolveConvocation(
  meeting: {
    scheduledAt2: Date;
    status: string;
    effectiveConvocation?: ConvocationCall | null;
    celebratedAt?: Date | null;
  },
  options: { at?: Date; override?: ConvocationCall; now?: Date } = {},
): { call: ConvocationCall; source: ConvocationSource } {
  if (options.override) return { call: options.override, source: 'explicit' };
  if (meeting.effectiveConvocation) return { call: meeting.effectiveConvocation, source: 'confirmed' };
  const byTime = (at: Date): ConvocationCall => (at.getTime() < meeting.scheduledAt2.getTime() ? 'primera' : 'segunda');
  if (options.at) return { call: byTime(options.at), source: 'at' };
  if (meeting.status === 'convocada') return { call: byTime(options.now ?? new Date()), source: 'now' };
  if (meeting.celebratedAt) return { call: byTime(meeting.celebratedAt), source: 'celebratedAt' };
  return { call: 'segunda', source: 'scheduledAt2' };
}

/** Propiedad del censo tal y como entra en el cálculo (sirve igual para datos vivos que congelados). */
export interface QuorumCensusProperty {
  id: string;
  ref: string | null;
  participationQuota: { toString(): string } | number | string | null;
}

/**
 * Cálculo puro del quórum (art. 16 LPH: doble mayoría simultánea en 1ª convocatoria, ninguna
 * en 2ª). No lee la base de datos ni la hora: el mismo cálculo sirve para una junta en curso
 * y para reproducir una ya celebrada a partir de un snapshot.
 */
export function buildQuorum(input: {
  call: ConvocationCall;
  source: ConvocationSource;
  properties: QuorumCensusProperty[];
  presentIds: Set<string>;
  attendeeNamesByProperty?: Map<string, string[]>;
}): QuorumResult {
  const { properties, presentIds } = input;
  const quotaOf = (p: QuorumCensusProperty) => Number(p.participationQuota ?? 0);
  const attendingProperties = properties.filter((p) => presentIds.has(p.id));
  const censusQuota = properties.reduce((s, p) => s + quotaOf(p), 0);
  const attendingQuota = attendingProperties.reduce((s, p) => s + quotaOf(p), 0);
  const ownersPct = properties.length ? (attendingProperties.length / properties.length) * 100 : 0;
  const quotaPct = censusQuota > 0 ? (attendingQuota / censusQuota) * 100 : 0;
  const quorumRequired = input.call === 'primera';
  // Doble mayoría simultánea (art. 16 LPH): propietarios Y cuotas, ambas
  // estrictamente por encima del 50%.
  const quorumMet = !quorumRequired || (ownersPct > 50 && quotaPct > 50);

  return {
    convocatoria: input.call,
    convocatoriaSource: input.source,
    quorumRequired,
    quorumMet,
    owners: { present: attendingProperties.length, total: properties.length, percent: round2(ownersPct) },
    quota: { present: round2(attendingQuota), total: round2(censusQuota), percent: round2(quotaPct) },
    missingParticipationQuotaCount: properties.filter((p) => p.participationQuota == null).length,
    attendingProperties: attendingProperties.map((p) => ({
      propertyId: p.id,
      ref: p.ref,
      participationQuota: p.participationQuota == null ? null : p.participationQuota.toString(),
      attendeeNames: input.attendeeNamesByProperty?.get(p.id) ?? [],
    })),
  };
}

/**
 * Aislado de `MeetingsService` (ya voluminoso) porque es una pieza de
 * cálculo propia: cruza el censo real de la finca (`Property` +
 * `participationQuota`) contra `MeetingAttendance`, no solo lectura/escritura
 * de un recurso. Ver plan de Fase 1 — quórum real en juntas.
 */
@Injectable()
export class MeetingQuorumService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quórum con los datos VIVOS de la junta (censo, asistencia y delegaciones de ahora). La
   * convocatoria se resuelve con `resolveConvocation`: una junta ya celebrada no depende de la
   * hora actual. Para reproducir el pasado se usa el snapshot del acta, no este método.
   */
  async computeQuorum(meetingId: string, at?: Date, convocatoria?: ConvocationCall): Promise<QuorumResult> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { estateId: true, scheduledAt2: true, status: true, effectiveConvocation: true, celebratedAt: true },
    });
    const resolved = resolveConvocation(meeting, { at, override: convocatoria });

    const properties = await this.prisma.property.findMany({
      where: { estateId: meeting.estateId, deletedAt: null },
      select: { id: true, ref: true, participationQuota: true },
    });

    const attendingIds = await listPresentPropertyIds(this.prisma, meetingId);
    const allAttendanceRows = await this.prisma.meetingAttendance.findMany({
      where: { meetingId },
      select: { propertyId: true, displayName: true },
    });
    const delegationRows = await this.prisma.meetingVoteDelegation.findMany({
      where: { meetingId, revokedAt: null },
      select: {
        propertyId: true,
        representativeName: true,
        representativeUser: { select: { fullName: true } },
      },
    });

    const names = new Map<string, string[]>();
    for (const row of allAttendanceRows) names.set(row.propertyId, [...(names.get(row.propertyId) ?? []), row.displayName]);
    for (const row of delegationRows) {
      names.set(row.propertyId, [
        ...(names.get(row.propertyId) ?? []),
        `${row.representativeUser?.fullName ?? row.representativeName} (representante)`,
      ]);
    }

    return buildQuorum({
      call: resolved.call,
      source: resolved.source,
      properties,
      presentIds: attendingIds,
      attendeeNamesByProperty: names,
    });
  }
}
