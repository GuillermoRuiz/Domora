import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  printableAttendance,
  type ActaDocumentModel,
} from './acta/acta-document.model';
import type {
  Meeting,
  MeetingAttendance,
  MeetingVoteDelegation,
  VoteSession,
} from '../prisma/client';
import type { QuorumResult } from './meeting-quorum.service';

const MAJORITY_LABELS: Record<string, string> = {
  unanimidad: 'Unanimidad',
  tresQuintos: 'Tres quintas partes (3/5)',
  mayoriaSimple: 'Mayoría simple',
};

interface AgendaItemLike {
  id?: unknown;
  title?: unknown;
  comments?: unknown;
  voteTemplate?: { questions?: { title?: unknown }[] };
}

function formatDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${day}/${month}/${date.getFullYear()} a las ${time}`;
}

function findAgendaItem(
  agenda: unknown,
  agendaItemId: string,
): AgendaItemLike | undefined {
  if (!Array.isArray(agenda)) return undefined;
  return (agenda as AgendaItemLike[]).find((item) => item.id === agendaItemId);
}

/** Sección de texto libre (una línea por párrafo); no se escribe si la gestora no anotó nada. */
function freeTextSection(
  heading: string,
  text: string | null | undefined,
): Paragraph[] {
  const lines = (text ?? '').trim();
  if (!lines) return [];
  return [
    new Paragraph({ text: heading, heading: HeadingLevel.HEADING_2 }),
    ...lines.split(/\r?\n/).map((line) => new Paragraph({ text: line })),
    new Paragraph({ text: '' }),
  ];
}

export interface ActaData {
  quorum: QuorumResult;
  attendance: (MeetingAttendance & { property: { ref: string | null } })[];
  delegations: (MeetingVoteDelegation & {
    property: { ref: string | null };
    delegatorUser: { fullName: string };
    representativeUser: { fullName: string } | null;
  })[];
  voteSessions: VoteSession[];
  presidenteName: string;
  secretarioName: string;
}

/**
 * Genera el acta en `.docx` (mismo uso de `docx` que `ConvocatoriaDocxService`)
 * — pero a diferencia de la convocatoria, el resultado SE PERSISTE
 * (`MeetingsService.signActa` lo guarda vía `StorageService`) en el momento
 * de la firma: su contenido (quórum, asistencia, delegaciones, resultados de
 * voto) es un snapshot legal de ese instante, y una delegación revocada
 * después no debe alterar un acta ya firmada.
 *
 * Fuente de verdad del contenido: `ActaDocumentModel` (`generateFromModel`), el mismo que usan la
 * vista previa y el PDF. `generate()` es el generador HEREDADO: solo se usa para juntas sin
 * versión canónica del acta, y no debe ampliarse (reconstruye asistencia y resultados por su cuenta).
 */
@Injectable()
export class ActaDocxService {
  /** Acta en `.docx` a partir del modelo canónico: no recalcula asistencia, votos ni acuerdos. */
  async generateFromModel(model: ActaDocumentModel): Promise<Buffer> {
    const centered = (
      text: string,
      options: { bold?: boolean; size?: number } = {},
    ) =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text, bold: options.bold, size: options.size }),
        ],
      });
    const heading = (text: string) =>
      new Paragraph({
        text,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 280 },
      });
    const body = (
      text: string,
      options: { bold?: boolean; italics?: boolean; indent?: number } = {},
    ) =>
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: options.indent ? { left: options.indent } : undefined,
        children: [
          new TextRun({ text, bold: options.bold, italics: options.italics }),
        ],
      });
    const lines = (text: string) => text.split('\n').filter(Boolean);
    const cell = (text: string, bold = false) =>
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
      });

    // Igual que el PDF: el DNI nunca sale en el acta.
    const attendance = printableAttendance(
      model.labels.attendanceColumns,
      model.attendance.rows,
    );
    const children: (Paragraph | Table)[] = [
      centered(model.header.title, { bold: true, size: 28 }),
      centered(model.header.subtitle, { bold: true, size: 24 }),
      centered(model.header.communityName.toUpperCase(), {
        bold: true,
        size: 24,
      }),
      ...(model.header.address ? [centered(model.header.address)] : []),
      new Paragraph({ text: '' }),
      ...lines(model.constitution.introduction.text).map((line) => body(line)),
      body(model.constitution.paragraph),
      heading(model.labels.agenda),
      ...model.agenda.map((entry) => body(entry.line, { indent: 280 })),
      heading(model.labels.attendance),
      body(model.attendance.summary.sentence),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            tableHeader: true,
            children: attendance.labels.map((label) => cell(label, true)),
          }),
          ...attendance.rows.map(
            (row) => new TableRow({ children: row.map((text) => cell(text)) }),
          ),
        ],
      }),
      heading(model.labels.development),
    ];

    for (const item of model.items) {
      children.push(
        new Paragraph({
          spacing: { before: 200 },
          children: [new TextRun({ text: item.headingText, bold: true })],
        }),
      );
      for (const line of lines(item.narrative.text)) children.push(body(line));
      if (item.stateText)
        children.push(body(item.stateText, { italics: true }));
      for (const vote of item.votes) {
        if (vote.lines.question) children.push(body(vote.lines.question));
        for (const option of vote.lines.options)
          children.push(body(option, { indent: 360 }));
        children.push(body(vote.lines.majority));
        if (vote.lines.favorable) children.push(body(vote.lines.favorable));
        if (vote.lines.outcome)
          children.push(body(vote.lines.outcome, { bold: true }));
      }
      for (const agreement of item.agreements)
        children.push(body(agreement.line, { bold: true }));
    }

    if (model.observations.text) {
      children.push(
        heading(model.observations.title),
        ...lines(model.observations.text).map((line) => body(line)),
      );
    }
    if (model.nextSteps.text) {
      children.push(
        heading(model.nextSteps.title),
        ...lines(model.nextSteps.text).map((line) =>
          body(`–  ${line}`, { indent: 200 }),
        ),
      );
    }
    if (model.closing.paragraph)
      children.push(new Paragraph({ text: '' }), body(model.closing.paragraph));

    children.push(new Paragraph({ text: '' }), new Paragraph({ text: '' }));
    for (const block of model.signatures.blocks) {
      for (const line of block.lines)
        children.push(centered(line, { bold: true }));
      children.push(
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),
      );
    }

    return Packer.toBuffer(new Document({ sections: [{ children }] }));
  }

  /** @deprecated Generador heredado: solo para juntas sin versión canónica del acta. */
  async generate(meeting: Meeting, data: ActaData): Promise<Buffer> {
    const {
      quorum,
      attendance,
      delegations,
      voteSessions,
      presidenteName,
      secretarioName,
    } = data;

    const attendanceParagraphs = attendance.length
      ? attendance.map(
          (a) =>
            new Paragraph({
              text: `${a.property.ref ?? a.propertyId} — ${a.displayName}`,
            }),
        )
      : [new Paragraph({ text: 'Sin asistentes registrados.' })];

    const delegationParagraphs = delegations
      .filter((d) => !d.revokedAt)
      .map(
        (d) =>
          new Paragraph({
            text: `${d.property.ref ?? d.propertyId}: ${d.delegatorUser.fullName} delega en ${d.representativeUser?.fullName ?? `${d.representativeName} (DNI ${d.representativeDni})`}`,
          }),
      );

    // Orden del día con los comentarios que el administrador anotó en cada punto.
    const agendaItems = Array.isArray(meeting.agenda)
      ? (meeting.agenda as AgendaItemLike[])
      : [];
    const agendaParagraphs = agendaItems.flatMap((item, index) => {
      const title =
        typeof item.title === 'string' ? item.title : `Punto ${index + 1}`;
      const comments =
        typeof item.comments === 'string' ? item.comments.trim() : '';
      return [
        new Paragraph({
          children: [
            new TextRun({ text: `${index + 1}. ${title}`, bold: true }),
          ],
        }),
        ...(comments
          ? comments
              .split(/\r?\n/)
              .map(
                (line) => new Paragraph({ text: line, indent: { left: 360 } }),
              )
          : []),
      ];
    });

    const voteParagraphs = voteSessions.flatMap((session) => {
      const item = findAgendaItem(meeting.agenda, session.agendaItemId);
      const questionTitle =
        item?.voteTemplate?.questions?.[session.questionIndex]?.title;
      const title =
        typeof questionTitle === 'string'
          ? questionTitle
          : `Punto ${session.agendaItemId}`;
      const result = session.resultSummary as {
        passed?: boolean | null;
        ownersFavorablePct?: number;
        quotaFavorablePct?: number;
        denominatorBasis?: string;
      } | null;
      const verdict =
        result?.passed === true
          ? 'APROBADO'
          : result?.passed === false
            ? 'RECHAZADO'
            : 'Sin veredicto (selección múltiple)';
      return [
        new Paragraph({
          children: [
            new TextRun({ text: `${title} — `, bold: true }),
            new TextRun(
              `${MAJORITY_LABELS[session.majorityType] ?? session.majorityType} — ${verdict}`,
            ),
          ],
        }),
        new Paragraph({
          text: `Propietarios: ${result?.ownersFavorablePct ?? 0}% · Cuotas: ${result?.quotaFavorablePct ?? 0}% (${result?.denominatorBasis === 'censo' ? 'sobre el censo total' : 'sobre los presentes'})`,
        }),
      ];
    });

    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: 'Acta de la Junta',
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              text: meeting.title,
              heading: HeadingLevel.HEADING_2,
            }),
            new Paragraph({
              children: [
                new TextRun({ text: 'Celebrada: ', bold: true }),
                new TextRun(
                  meeting.celebratedAt
                    ? formatDateTime(meeting.celebratedAt)
                    : formatDateTime(meeting.scheduledAt1),
                ),
              ],
            }),
            new Paragraph({ text: '' }),

            new Paragraph({ text: 'Quórum', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({
              text: `${quorum.convocatoria === 'primera' ? '1ª convocatoria' : '2ª convocatoria'} — ${
                quorum.quorumRequired
                  ? quorum.quorumMet
                    ? 'quórum alcanzado'
                    : 'quórum NO alcanzado'
                  : 'sin quórum exigible'
              }`,
            }),
            new Paragraph({
              text: `Propietarios presentes: ${quorum.owners.present}/${quorum.owners.total} (${quorum.owners.percent}%) — Cuotas presentes: ${quorum.quota.percent}%`,
            }),
            new Paragraph({ text: '' }),

            new Paragraph({
              text: 'Asistentes',
              heading: HeadingLevel.HEADING_2,
            }),
            ...attendanceParagraphs,
            new Paragraph({ text: '' }),

            new Paragraph({
              text: 'Delegaciones de voto',
              heading: HeadingLevel.HEADING_2,
            }),
            ...(delegationParagraphs.length > 0
              ? delegationParagraphs
              : [new Paragraph({ text: 'Sin delegaciones activas.' })]),
            new Paragraph({ text: '' }),

            new Paragraph({
              text: 'Orden del día',
              heading: HeadingLevel.HEADING_2,
            }),
            ...(agendaParagraphs.length > 0
              ? agendaParagraphs
              : [new Paragraph({ text: 'Sin puntos en el orden del día.' })]),
            new Paragraph({ text: '' }),

            new Paragraph({
              text: 'Acuerdos y votaciones',
              heading: HeadingLevel.HEADING_2,
            }),
            ...(voteParagraphs.length > 0
              ? voteParagraphs
              : [new Paragraph({ text: 'Sin votaciones registradas.' })]),
            new Paragraph({ text: '' }),

            ...freeTextSection(
              'Comentarios generales',
              meeting.actaGeneralComments,
            ),
            ...freeTextSection(
              'Comentarios y próximos pasos',
              meeting.actaNextSteps,
            ),

            new Paragraph({ text: 'Firmas', heading: HeadingLevel.HEADING_2 }),
            new Paragraph({ text: `Presidente: ${presidenteName}` }),
            new Paragraph({ text: `Secretario: ${secretarioName}` }),
          ],
        },
      ],
    });

    return Packer.toBuffer(document);
  }
}
