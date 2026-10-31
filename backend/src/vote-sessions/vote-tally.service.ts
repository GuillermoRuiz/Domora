import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { listPresentPropertyIds } from '../meetings/meeting-quorum.service';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface VoteTallyOptionCount {
  optionIndex: number;
  propertyCount: number;
}

export interface VoteTallyResult {
  /** 'censo' para unanimidad/tresQuintos (art. 17.2 LPH: "del total de los propietarios"), 'presentes' solo para mayoriaSimple (art. 17.7: "de los presentes"). */
  denominatorBasis: 'censo' | 'presentes';
  ownersFavorablePct: number;
  ownersDenominatorCount: number;
  quotaFavorablePct: number;
  quotaDenominatorTotal: number;
  /** null para preguntas multiple_choice — no hay noción legal clara de "favorable" en selección múltiple, ver comentario más abajo. */
  passed: boolean | null;
  optionTally: VoteTallyOptionCount[];
}

/**
 * Aislado igual que `MeetingQuorumService` — cálculo puro sobre filas, no
 * CRUD. Implementa la tabla de denominadores verificada contra el texto del
 * art. 17 LPH (Fase 2.1, plan de "Juntas al máximo"):
 *
 *   unanimidad    → censo completo de Property de la finca, umbral 100%
 *   tresQuintos   → censo completo de Property de la finca, umbral ≥60%
 *   mayoriaSimple → solo propiedades presentes (MeetingAttendance o delegación vigente), umbral >50%
 *
 * Confundir esto (tratar el 3/5 como "de los presentes") infla artificialmente
 * el resultado y puede dar por aprobado un acuerdo que legalmente no lo está.
 * "Favorable" para preguntas `single_choice` es, por convención de producto,
 * la opción de índice 0 (`agenda-builder` siempre construye "A favor" como
 * primera opción) — no hay forma de inferir semánticamente qué opción
 * significa "sí" a partir de texto libre.
 */
@Injectable()
export class VoteTallyService {
  constructor(private readonly prisma: PrismaService) {}

  async tally(
    meetingId: string,
    voteSessionId: string,
    majorityType: 'unanimidad' | 'tresQuintos' | 'mayoriaSimple',
    questionType: 'single_choice' | 'multiple_choice',
  ): Promise<VoteTallyResult> {
    const meeting = await this.prisma.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { estateId: true },
    });

    const census = await this.prisma.property.findMany({
      where: { estateId: meeting.estateId, deletedAt: null },
      select: { id: true, participationQuota: true },
    });

    const responses = await this.prisma.voteResponse.findMany({
      where: { voteSessionId },
      select: { propertyId: true, optionIndex: true, optionIndexes: true },
    });

    const denominatorBasis: 'censo' | 'presentes' =
      majorityType === 'mayoriaSimple' ? 'presentes' : 'censo';

    let denominatorProperties = census;
    if (denominatorBasis === 'presentes') {
      const attendingIds = await listPresentPropertyIds(this.prisma, meetingId);
      denominatorProperties = census.filter((p) => attendingIds.has(p.id));
    }

    const quotaDenominatorTotal = denominatorProperties.reduce(
      (sum, p) => sum + Number(p.participationQuota ?? 0),
      0,
    );

    // Favorable = respondió single_choice con optionIndex 0, Y la propiedad
    // pertenece al conjunto que cuenta para este majorityType (censo o
    // presentes). Una propiedad que votó pero no está en el denominador
    // (ej. votó sin haber sido marcada presente, caso raro pero posible si
    // el pase de lista se deshace después) no cuenta como favorable.
    const denominatorIds = new Set(denominatorProperties.map((p) => p.id));
    const favorableResponses = responses.filter(
      (r) => r.optionIndex === 0 && denominatorIds.has(r.propertyId),
    );
    const favorableProperties = denominatorProperties.filter((p) =>
      favorableResponses.some((r) => r.propertyId === p.id),
    );

    const ownersDenominatorCount = denominatorProperties.length;
    const ownersFavorablePct =
      ownersDenominatorCount > 0
        ? round2((favorableProperties.length / ownersDenominatorCount) * 100)
        : 0;
    const favorableQuota = favorableProperties.reduce(
      (sum, p) => sum + Number(p.participationQuota ?? 0),
      0,
    );
    const quotaFavorablePct =
      quotaDenominatorTotal > 0
        ? round2((favorableQuota / quotaDenominatorTotal) * 100)
        : 0;

    let passed: boolean | null = null;
    if (questionType === 'single_choice') {
      if (majorityType === 'unanimidad') {
        passed = ownersFavorablePct >= 100 && quotaFavorablePct >= 100;
      } else if (majorityType === 'tresQuintos') {
        passed = ownersFavorablePct >= 60 && quotaFavorablePct >= 60;
      } else {
        passed = ownersFavorablePct > 50 && quotaFavorablePct > 50;
      }
    }

    // Recuento bruto por opción — sobre TODAS las respuestas emitidas (no
    // restringido al denominador legal), es informativo, no el veredicto.
    const tallyMap = new Map<number, number>();
    for (const r of responses) {
      const indexes =
        questionType === 'multiple_choice'
          ? r.optionIndexes
          : r.optionIndex != null
            ? [r.optionIndex]
            : [];
      for (const idx of indexes) {
        tallyMap.set(idx, (tallyMap.get(idx) ?? 0) + 1);
      }
    }
    const optionTally: VoteTallyOptionCount[] = [...tallyMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([optionIndex, propertyCount]) => ({ optionIndex, propertyCount }));

    return {
      denominatorBasis,
      ownersFavorablePct,
      ownersDenominatorCount,
      quotaFavorablePct,
      quotaDenominatorTotal: round2(quotaDenominatorTotal),
      passed,
      optionTally,
    };
  }
}
