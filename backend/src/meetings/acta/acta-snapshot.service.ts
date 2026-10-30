import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { buildQuorum, type ConvocationCall } from '../meeting-quorum.service';
import {
  ACTA_SNAPSHOT_SCHEMA_VERSION,
  type ActaMajorityType,
  type ActaSnapshotAgendaItem,
  type ActaSnapshotAttendanceRow,
  type ActaSnapshotVote,
  type ActaSourceSnapshot,
} from './acta-snapshot.types';

interface AgendaQuestion {
  title?: string;
  type?: string;
  options?: string[];
}

interface AgendaRecord {
  id: string;
  title: string;
  description?: string;
  hasVote?: boolean;
  comments?: string;
  treatedAt?: string;
  voteTemplate?: { questions?: AgendaQuestion[] };
}

interface ResultSummaryShape {
  passed?: boolean | null;
  denominatorBasis?: 'censo' | 'presentes';
  ownersFavorablePct?: number;
  quotaFavorablePct?: number;
  optionTally?: { optionIndex: number; propertyCount: number }[];
}

/** Datos de entrada del snapshot ya leídos: así la función de construcción es pura y se prueba sin base de datos. */
export interface ActaSnapshotInput {
  now: Date;
  meeting: {
    id: string;
    type: 'ordinaria' | 'extraordinaria';
    title: string;
    status: string;
    scheduledAt1: Date;
    scheduledAt2: Date;
    location: string | null;
    effectiveConvocation: ConvocationCall;
    actualStartAt: Date | null;
    actualEndAt: Date | null;
    celebratedAt: Date | null;
    agenda: unknown;
    actaGeneralComments: string | null;
    actaNextSteps: string | null;
  };
  estate: { name: string; address: string | null; streetNumber: string | null; location: string | null };
  properties: {
    id: string;
    ref: string | null;
    floor: string | null;
    door: string | null;
    participationQuota: { toString(): string } | null;
  }[];
  attendedPropertyIds: Set<string>;
  delegatedPropertyIds: Set<string>;
  /** Nombre completo de quien asistió a cada propiedad (ya compuesto); sin entrada = no consta. */
  attendeeNamesByProperty?: Map<string, string>;
  /** DNI/NIF de quien asistió a cada propiedad; sin entrada = no consta. */
  attendeeDniByProperty?: Map<string, string>;
  voteSessions: {
    id: string;
    agendaItemId: string;
    questionIndex: number;
    majorityType: ActaMajorityType;
    closedAt: Date | null;
    resultSummary: unknown;
    responseCount: number;
  }[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Referencia mostrable de una propiedad: la misma que ve la gestora en la pantalla de participación. */
function displayRef(property: ActaSnapshotInput['properties'][number]): string {
  return property.ref?.trim() || [property.floor, property.door].filter(Boolean).join('') || '—';
}

function nonEmpty(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Construye el snapshot a partir de datos ya leídos. Copia VALORES (texto del coeficiente,
 * recuentos, etiquetas de opción…): nada queda enlazado a filas vivas.
 */
export function buildActaSnapshot(input: ActaSnapshotInput): ActaSourceSnapshot {
  const { meeting, estate } = input;
  const agendaRecords = (Array.isArray(meeting.agenda) ? (meeting.agenda as AgendaRecord[]) : []).filter((item) => item && typeof item.id === 'string');

  const presentIds = new Set<string>([...input.attendedPropertyIds, ...input.delegatedPropertyIds]);
  const quorum = buildQuorum({
    call: meeting.effectiveConvocation,
    source: 'confirmed',
    properties: input.properties.map((p) => ({ id: p.id, ref: displayRef(p), participationQuota: p.participationQuota })),
    presentIds,
  });

  const byRef = (a: ActaSnapshotAttendanceRow, b: ActaSnapshotAttendanceRow) => a.ref.localeCompare(b.ref, 'es', { numeric: true });
  const attendance: ActaSnapshotAttendanceRow[] = input.properties
    .filter((property) => presentIds.has(property.id))
    .map((property) => ({
      propertyId: property.id,
      ref: displayRef(property),
      participationQuota: property.participationQuota == null ? null : property.participationQuota.toString(),
      // Una delegación vigente significa «representada», aunque el representante no haya entrado a la sala.
      status: input.delegatedPropertyIds.has(property.id) ? ('representada' as const) : ('presente' as const),
      attendeeName: input.attendeeNamesByProperty?.get(property.id) ?? null,
      attendeeDni: input.attendeeDniByProperty?.get(property.id) ?? null,
    }))
    .sort(byRef);

  const agenda: ActaSnapshotAgendaItem[] = agendaRecords.map((item, index) => ({
    id: item.id,
    order: index + 1,
    title: item.title,
    description: nonEmpty(item.description),
    comments: nonEmpty(item.comments),
    treatedAt: item.treatedAt ?? null,
    hasVote: !!item.hasVote,
  }));

  const votes: ActaSnapshotVote[] = [];
  for (const session of input.voteSessions) {
    const item = agendaRecords.find((entry) => entry.id === session.agendaItemId);
    const question = item?.voteTemplate?.questions?.[session.questionIndex];
    if (!item || !question || question.type === 'text') continue;
    const summary = (session.resultSummary ?? null) as ResultSummaryShape | null;
    const labels = question.options ?? [];
    const total = session.responseCount;
    const countOf = (index: number) => summary?.optionTally?.find((entry) => entry.optionIndex === index)?.propertyCount ?? 0;
    votes.push({
      voteSessionId: session.id,
      agendaItemId: session.agendaItemId,
      questionIndex: session.questionIndex,
      question: { title: question.title ?? item.title, type: question.type === 'multiple_choice' ? 'multiple_choice' : 'single_choice' },
      majorityType: session.majorityType,
      closedAt: session.closedAt ? session.closedAt.toISOString() : null,
      totalResponses: total,
      options: labels.map((label, optionIndex) => ({
        optionIndex,
        label,
        count: countOf(optionIndex),
        percent: total > 0 ? round2((countOf(optionIndex) / total) * 100) : 0,
      })),
      passed: typeof summary?.passed === 'boolean' ? summary.passed : null,
      denominatorBasis: summary?.denominatorBasis ?? null,
      ownersFavorablePct: summary?.ownersFavorablePct ?? null,
      quotaFavorablePct: summary?.quotaFavorablePct ?? null,
      // Copia profunda: el JSON de la sesión no debe quedar compartido con el snapshot.
      resultSummary: summary ? JSON.parse(JSON.stringify(summary)) : null,
    });
  }

  return {
    schemaVersion: ACTA_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: input.now.toISOString(),
    meeting: {
      id: meeting.id,
      type: meeting.type,
      title: meeting.title,
      status: meeting.status,
      scheduledAt1: meeting.scheduledAt1.toISOString(),
      scheduledAt2: meeting.scheduledAt2.toISOString(),
      location: nonEmpty(meeting.location),
      effectiveConvocation: meeting.effectiveConvocation,
      actualStartAt: meeting.actualStartAt ? meeting.actualStartAt.toISOString() : null,
      actualEndAt: meeting.actualEndAt ? meeting.actualEndAt.toISOString() : null,
      celebratedAt: meeting.celebratedAt ? meeting.celebratedAt.toISOString() : null,
    },
    community: {
      name: estate.name,
      address: nonEmpty([estate.address, estate.streetNumber].filter(Boolean).join(' ')),
      locality: nonEmpty(estate.location),
    },
    census: {
      propertyCount: input.properties.length,
      totalQuota: quorum.quota.total,
      missingQuotaCount: quorum.missingParticipationQuotaCount,
    },
    quorum: {
      convocatoria: quorum.convocatoria,
      quorumRequired: quorum.quorumRequired,
      quorumMet: quorum.quorumMet,
      owners: quorum.owners,
      quota: quorum.quota,
    },
    attendance,
    agenda,
    votes,
    text: {
      generalComments: nonEmpty(meeting.actaGeneralComments),
      nextSteps: nonEmpty(meeting.actaNextSteps),
    },
  };
}

interface AttendeeRow {
  propertyId: string;
  displayName: string | null;
  user: { taxId: string | null } | null;
}
interface DelegationNameRow {
  propertyId: string;
  representativeName: string | null;
  representativeDni: string | null;
  representativeUser: { fullName: string; taxId: string | null } | null;
  delegatorUser: { fullName: string } | null;
}

export interface AttendeeIdentities {
  names: Map<string, string>;
  dnis: Map<string, string>;
}

/**
 * Nombre completo y DNI de quien asistió a cada propiedad: los asistentes (varios cotitulares se
 * unen con coma) o, si hay una delegación vigente, el representante indicando a quién representa.
 */
export function composeAttendeeIdentities(attendance: AttendeeRow[], delegations: DelegationNameRow[]): AttendeeIdentities {
  const names = new Map<string, string>();
  const dnis = new Map<string, string>();
  const append = (map: Map<string, string>, propertyId: string, value: string) => {
    const known = map.get(propertyId)?.split(', ') ?? [];
    if (!known.includes(value)) map.set(propertyId, [...known, value].join(', '));
  };
  for (const row of attendance) {
    const name = row.displayName?.trim();
    if (!name) continue;
    append(names, row.propertyId, name);
    const dni = row.user?.taxId?.trim();
    if (dni) append(dnis, row.propertyId, dni);
  }
  // Una delegación vigente manda: quien figura es el representante, indicando a quién representa.
  for (const row of delegations) {
    const representative = (row.representativeUser?.fullName ?? row.representativeName)?.trim();
    if (!representative) continue;
    const owner = row.delegatorUser?.fullName?.trim();
    names.set(row.propertyId, owner ? `${representative}, en representación de ${owner}` : representative);
    const dni = (row.representativeUser?.taxId ?? row.representativeDni)?.trim();
    if (dni) dnis.set(row.propertyId, dni);
    else dnis.delete(row.propertyId);
  }
  return { names, dnis };
}

/**
 * Lee de la base de datos lo necesario y lo congela. Es lo único que consulta datos vivos para
 * el acta; a partir de aquí, el documento solo usa el snapshot.
 */
@Injectable()
export class ActaSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /** Nombres y DNI de quienes asisten ahora a cada propiedad (para completar borradores anteriores a incluirlos). */
  async attendeeIdentities(meetingId: string): Promise<AttendeeIdentities> {
    const [attendance, delegations] = await Promise.all([
      this.prisma.meetingAttendance.findMany({
        where: { meetingId },
        orderBy: { joinedAt: 'asc' },
        select: { propertyId: true, displayName: true, user: { select: { taxId: true } } },
      }),
      this.prisma.meetingVoteDelegation.findMany({
        where: { meetingId, revokedAt: null },
        select: {
          propertyId: true,
          representativeName: true,
          representativeDni: true,
          representativeUser: { select: { fullName: true, taxId: true } },
          delegatorUser: { select: { fullName: true } },
        },
      }),
    ]);
    return composeAttendeeIdentities(attendance, delegations);
  }

  async capture(meetingId: string, now: Date = new Date()): Promise<ActaSourceSnapshot> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      include: { estate: { select: { name: true, address: true, streetNumber: true, location: true } } },
    });
    if (!meeting.effectiveConvocation) {
      throw new Error('No se puede congelar el acta sin la convocatoria efectiva confirmada.');
    }
    const [properties, attendance, delegations, sessions] = await Promise.all([
      this.prisma.property.findMany({
        where: { estateId: meeting.estateId, deletedAt: null },
        select: { id: true, ref: true, floor: true, door: true, participationQuota: true },
      }),
      this.prisma.meetingAttendance.findMany({
        where: { meetingId },
        orderBy: { joinedAt: 'asc' },
        select: { propertyId: true, displayName: true, user: { select: { taxId: true } } },
      }),
      this.prisma.meetingVoteDelegation.findMany({
        where: { meetingId, revokedAt: null },
        select: {
          propertyId: true,
          representativeName: true,
          representativeDni: true,
          representativeUser: { select: { fullName: true, taxId: true } },
          delegatorUser: { select: { fullName: true } },
        },
      }),
      this.prisma.voteSession.findMany({
        where: { meetingId, status: 'cerrada' },
        orderBy: [{ closedAt: 'asc' }, { questionIndex: 'asc' }],
        include: { _count: { select: { responses: true } } },
      }),
    ]);
    const identities = composeAttendeeIdentities(attendance, delegations);
    return buildActaSnapshot({
      now,
      meeting: { ...meeting, effectiveConvocation: meeting.effectiveConvocation },
      estate: meeting.estate,
      properties,
      attendedPropertyIds: new Set(attendance.map((row) => row.propertyId)),
      delegatedPropertyIds: new Set(delegations.map((row) => row.propertyId)),
      attendeeNamesByProperty: identities.names,
      attendeeDniByProperty: identities.dnis,
      voteSessions: sessions.map((session) => ({
        id: session.id,
        agendaItemId: session.agendaItemId,
        questionIndex: session.questionIndex,
        majorityType: session.majorityType,
        closedAt: session.closedAt,
        resultSummary: session.resultSummary,
        responseCount: session._count.responses,
      })),
    });
  }
}
