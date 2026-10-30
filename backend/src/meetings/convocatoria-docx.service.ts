import { Injectable } from '@nestjs/common';
import { AlignmentType, Document, FrameAnchorType, HeightRule, HorizontalPositionAlign, Packer, Paragraph, TextRun, VerticalPositionAlign, FrameWrap } from 'docx';
import type { Meeting } from '../prisma/client';
import { buildDefaultConvocatoria, isConvocatoriaDocument, type ConvocatoriaDocument } from './convocatoria-document';

const FONT = 'Arial';
/** Tamaños en medios puntos (docx): 20 = 10 pt. */
const BODY = 20;

const PAGE_WIDTH = 11906; // A4
const MARGIN = { top: 1000, bottom: 1000, left: 1300, right: 1300 };

/**
 * Marco de texto pegado al borde inferior del área de texto de la página. Los párrafos consecutivos con el
 * mismo marco forman un único bloque: así la autorización a recortar queda siempre a pie de página, sea cual
 * sea la cantidad de contenido de la convocatoria (el texto de arriba fluye alrededor, nunca debajo).
 */
const FOOTER_FRAME = {
  type: 'alignment' as const,
  alignment: { x: HorizontalPositionAlign.LEFT, y: VerticalPositionAlign.BOTTOM },
  anchor: { horizontal: FrameAnchorType.MARGIN, vertical: FrameAnchorType.MARGIN },
  width: PAGE_WIDTH - MARGIN.left - MARGIN.right,
  height: 1,
  rule: HeightRule.AUTO,
  wrap: FrameWrap.AROUND,
};

/** Un párrafo de texto corrido; `text` puede traer saltos de línea. */
function paragraph(
  text: string,
  options: { bold?: boolean; italics?: boolean; size?: number; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; indent?: number; before?: number; after?: number; frame?: typeof FOOTER_FRAME } = {},
): Paragraph {
  const lines = text.split('\n');
  return new Paragraph({
    frame: options.frame,
    alignment: options.alignment ?? AlignmentType.JUSTIFIED,
    indent: options.indent ? { left: options.indent } : undefined,
    spacing: { before: options.before ?? 0, after: options.after ?? 120 },
    children: lines.map(
      (line, index) =>
        new TextRun({ text: line, bold: options.bold, italics: options.italics, size: options.size ?? BODY, font: FONT, break: index > 0 ? 1 : undefined }),
    ),
  });
}

/** Un bloque con párrafos separados por línea en blanco. */
function paragraphsOf(text: string, options: Parameters<typeof paragraph>[1] = {}): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map((block) => paragraph(block, options));
}

function render(doc: ConvocatoriaDocument): Document {
  const children: Paragraph[] = [
    paragraph('Comunidad de propietarios', { bold: true, size: 30, alignment: AlignmentType.CENTER, after: 40 }),
    paragraph(doc.header.community, { bold: true, size: 30, alignment: AlignmentType.CENTER, after: 40 }),
    paragraph(doc.header.title, { bold: true, size: 20, alignment: AlignmentType.CENTER, after: 240 }),
    ...(doc.notice.trim() ? [paragraph(doc.notice, { italics: true, size: 22, after: 360 })] : []),
    ...(doc.issuedLine.trim() ? [paragraph(doc.issuedLine, { alignment: AlignmentType.RIGHT, after: 200 })] : []),
    ...(doc.greeting.trim() ? [paragraph(doc.greeting)] : []),
    ...paragraphsOf(doc.intro, { indent: 360 }),
    paragraph('ORDEN DEL DÍA', { bold: true, alignment: AlignmentType.CENTER, before: 80 }),
    ...doc.agenda.map(
      (line) =>
        new Paragraph({
          alignment: AlignmentType.LEFT,
          indent: { left: 720, hanging: 360 },
          spacing: { after: 60 },
          children: [new TextRun({ text: `${line.number}\t${line.text}`, bold: true, size: BODY, font: FONT })],
          tabStops: [{ type: 'left', position: 720 }],
        }),
    ),
    ...(doc.agenda.length === 0 ? [paragraph('Sin puntos registrados.', { alignment: AlignmentType.LEFT })] : []),
    ...paragraphsOf(doc.closing, { indent: 360, before: 120 }),
    ...doc.signature.filter((line) => line.trim()).map((line, index) => paragraph(line, { alignment: AlignmentType.LEFT, indent: 5400, before: index === 0 ? 240 : 0, after: 0 })),
  ];

  if (doc.authorization.enabled) {
    const frame = FOOTER_FRAME;
    children.push(
      paragraph('✂ ' + '-'.repeat(110), { alignment: AlignmentType.LEFT, size: 14, after: 160, frame }),
      ...paragraphsOf(doc.authorization.text, { alignment: AlignmentType.LEFT, indent: 360, frame }),
      paragraph('D/Dª ' + '_'.repeat(70), { alignment: AlignmentType.LEFT, indent: 360, before: 120, frame }),
      paragraph('Atentamente:', { alignment: AlignmentType.LEFT, indent: 360, before: 120, frame }),
      paragraph('Firmado: ' + '_'.repeat(30), { alignment: AlignmentType.LEFT, indent: 3600, before: 200, after: 0, frame }),
      paragraph('Propietario del: ' + '_'.repeat(20), { alignment: AlignmentType.LEFT, indent: 3600, frame }),
    );
  }

  return new Document({
    sections: [{ properties: { page: { size: { width: PAGE_WIDTH, height: 16838 }, margin: MARGIN } }, children }],
  });
}

/**
 * Genera la convocatoria en `.docx` PROGRAMÁTICAMENTE (librería `docx`) con el formato habitual de las
 * convocatorias de juntas (art. 16.2 LPH). Usa el texto que la gestora editó al crear la junta
 * (`Meeting.convocatoriaDoc`) o, si no hay, redacta el habitual con los datos de la junta. El documento
 * se genera al vuelo y no se persiste como archivo.
 */
@Injectable()
export class ConvocatoriaDocxService {
  /** El documento que se imprimirá: el guardado o el redactado por defecto. */
  resolveDocument(meeting: Meeting, community: { name: string; location?: string | null }): ConvocatoriaDocument {
    if (isConvocatoriaDocument(meeting.convocatoriaDoc)) return meeting.convocatoriaDoc;
    return buildDefaultConvocatoria({
      communityName: community.name,
      communityLocation: community.location,
      type: meeting.type,
      convokedBy: meeting.convokedBy,
      scheduledAt1: meeting.scheduledAt1,
      scheduledAt2: meeting.scheduledAt2,
      location: meeting.location,
      agenda: meeting.agenda,
      signerRole: meeting.signerRole,
      signerName: meeting.signerName,
      issuedAt: meeting.createdAt,
    });
  }

  async generate(meeting: Meeting, community: { name: string; location?: string | null } = { name: '' }): Promise<Buffer> {
    return Packer.toBuffer(render(this.resolveDocument(meeting, community)));
  }
}
