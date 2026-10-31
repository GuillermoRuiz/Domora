import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import {
  printableAttendance,
  type ActaDocumentModel,
  type ActaItem,
  type ActaVoteBlock,
} from './acta-document.model';

/** Opciones de render: nada de esto cambia el contenido del acta, solo lo que se rotula. */
export interface ActaPdfOptions {
  /** Texto discreto del pie izquierdo («SHA-256 1a2b3c4d»). */
  footerNote?: string;
  /** Comprimir el flujo (por defecto sí). Las pruebas lo desactivan para poder leer el texto. */
  compress?: boolean;
}

const FONT = {
  regular: 'Times-Roman',
  bold: 'Times-Bold',
  italic: 'Times-Italic',
} as const;
const COLORS = { text: '#000000', muted: '#555555', line: '#999999' };

// A4: 595.28 × 841.89 pt. Márgenes de documento formal (≈ 25 mm laterales, 25 mm vertical).
const MARGIN = { top: 72, bottom: 72, left: 70, right: 70 };
const BODY_SIZE = 11;
const ROW_HEIGHT = 16;

/** Las fuentes estándar de PDF solo cubren WinAnsi: se descartan los caracteres que no están en él. */
const WIN_ANSI_EXTRAS = new Set([
  '€',
  '—',
  '–',
  '‘',
  '’',
  '“',
  '”',
  '•',
  '…',
  '™',
  '‚',
  '„',
  '†',
  '‡',
  'ˆ',
  '‰',
  'Š',
  '‹',
  'Œ',
  'Ž',
  '›',
  'œ',
  'ž',
  'Ÿ',
  'š',
  '˜',
  'ƒ',
]);
function pdfText(text: string): string {
  let out = '';
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 0;
    if (
      char === '\n' ||
      char === '\t' ||
      (code >= 32 && code <= 255 && code !== 127) ||
      WIN_ANSI_EXTRAS.has(char)
    )
      out += char;
    else if (code === 0x00a0 || code === 0x202f) out += ' ';
  }
  return out;
}

/**
 * Renderiza el PDF del acta a partir de un `ActaDocumentModel`. No consulta datos vivos ni
 * recalcula nada: lo que sale es exactamente lo que dice el modelo de esa versión.
 * A4, texto negro sobre fondo blanco, páginas numeradas, filas de asistencia que no se parten,
 * encabezados de punto que no se quedan solos al final de página y firmas siempre juntas.
 */
@Injectable()
export class ActaPdfService {
  async render(
    model: ActaDocumentModel,
    options: ActaPdfOptions = {},
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { ...MARGIN },
      bufferPages: true,
      compress: options.compress ?? true,
      info: {
        Title: `${model.header.title} — ${model.header.communityName}`,
        Author: 'Domora',
        Subject: 'Acta de junta',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) =>
      doc.on('end', () => resolve(Buffer.concat(chunks))),
    );

    const left = MARGIN.left;
    const width = doc.page.width - MARGIN.left - MARGIN.right;
    const bottomLimit = () => doc.page.height - MARGIN.bottom;

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > bottomLimit()) doc.addPage();
    };
    const textHeight = (
      text: string,
      font: string,
      size: number,
      opts: PDFKit.Mixins.TextOptions = {},
    ) => {
      doc.font(font).fontSize(size);
      return doc.heightOfString(pdfText(text), { width, ...opts });
    };
    const paragraph = (
      text: string,
      opts: {
        font?: string;
        size?: number;
        align?: 'left' | 'justify' | 'center';
        indent?: number;
        gap?: number;
      } = {},
    ) => {
      const font = opts.font ?? FONT.regular;
      const size = opts.size ?? BODY_SIZE;
      const indent = opts.indent ?? 0;
      doc.font(font).fontSize(size).fillColor(COLORS.text);
      const content = pdfText(text);
      const height = doc.heightOfString(content, {
        width: width - indent,
        align: opts.align ?? 'left',
        lineGap: 2,
      });
      // Un párrafo corto no se parte; uno largo puede continuar en la página siguiente.
      if (height < 160) ensureSpace(height);
      doc.text(content, left + indent, doc.y, {
        width: width - indent,
        align: opts.align ?? 'left',
        lineGap: 2,
      });
      doc.moveDown((opts.gap ?? 0.6) * (size / BODY_SIZE));
    };
    const heading = (title: string, keepWith = 60) => {
      ensureSpace(24 + keepWith);
      doc.moveDown(0.8);
      doc
        .font(FONT.bold)
        .fontSize(BODY_SIZE)
        .fillColor(COLORS.text)
        .text(pdfText(title), left, doc.y, { width });
      doc.moveDown(0.4);
    };
    const rule = () => {
      doc
        .moveTo(left, doc.y)
        .lineTo(left + width, doc.y)
        .lineWidth(0.5)
        .strokeColor(COLORS.line)
        .stroke();
    };

    // ── 1. Encabezado ────────────────────────────────────────────────────────
    doc
      .font(FONT.bold)
      .fontSize(14)
      .fillColor(COLORS.text)
      .text(pdfText(model.header.title), left, doc.y, {
        width,
        align: 'center',
      });
    doc
      .font(FONT.bold)
      .fontSize(12)
      .text(pdfText(model.header.subtitle), left, doc.y + 2, {
        width,
        align: 'center',
      });
    doc.moveDown(0.5);
    doc
      .font(FONT.bold)
      .fontSize(12)
      .text(pdfText(model.header.communityName.toUpperCase()), left, doc.y, {
        width,
        align: 'center',
      });
    if (model.header.address) {
      doc
        .font(FONT.regular)
        .fontSize(BODY_SIZE)
        .text(pdfText(model.header.address), left, doc.y + 1, {
          width,
          align: 'center',
        });
    }
    doc.moveDown(0.8);
    rule();
    doc.moveDown(1);

    // ── 2. Constitución ──────────────────────────────────────────────────────
    if (model.constitution.introduction.text) {
      for (const part of model.constitution.introduction.text.split('\n'))
        paragraph(part, { align: 'justify' });
    }
    paragraph(model.constitution.paragraph, { align: 'justify' });

    // ── 3. Orden del día ─────────────────────────────────────────────────────
    heading(model.labels.agenda, 40);
    for (const entry of model.agenda) {
      paragraph(entry.line, { indent: 14, gap: 0.2 });
    }
    if (model.agenda.length === 0)
      paragraph('No constan puntos en el orden del día.', {
        font: FONT.italic,
      });
    doc.moveDown(0.4);

    // ── 4. Asistencia ────────────────────────────────────────────────────────
    heading(model.labels.attendance, 80);
    paragraph(model.attendance.summary.sentence, { align: 'justify' });
    this.attendanceTable(doc, model, left, width, ensureSpace, bottomLimit);

    // ── 5. Desarrollo ────────────────────────────────────────────────────────
    heading(model.labels.development, 80);
    for (const item of model.items)
      this.item(doc, item, { left, width, paragraph, ensureSpace, textHeight });

    // ── Observaciones / actuaciones ──────────────────────────────────────────
    if (model.observations.text) {
      heading(model.observations.title, 50);
      for (const part of model.observations.text.split('\n'))
        paragraph(part, { align: 'justify' });
    }
    if (model.nextSteps.text) {
      heading(model.nextSteps.title, 50);
      for (const line of model.nextSteps.text.split('\n'))
        paragraph(`–  ${line}`, { indent: 10, gap: 0.3 });
    }

    // ── 7. Cierre ────────────────────────────────────────────────────────────
    if (model.closing.paragraph) {
      doc.moveDown(0.6);
      paragraph(model.closing.paragraph, { align: 'justify' });
    }

    // ── 8. Firmas (siempre juntas) ───────────────────────────────────────────
    this.signatures(doc, model, left, width, ensureSpace);

    // ── Encabezados y pies de página ─────────────────────────────────────────
    this.decoratePages(doc, model, options, left, width);

    doc.end();
    return finished;
  }

  private attendanceTable(
    doc: PDFKit.PDFDocument,
    model: ActaDocumentModel,
    left: number,
    width: number,
    ensureSpace: (needed: number) => void,
    bottomLimit: () => number,
  ): void {
    // Actas anteriores llevan menos columnas (sin asistente): mantienen las suyas.
    const { labels, rows } = printableAttendance(
      model.labels.attendanceColumns,
      model.attendance.rows,
    );
    const layouts: Record<
      number,
      { share: number; align: 'left' | 'right' }[]
    > = {
      3: [
        { share: 0.3, align: 'left' },
        { share: 0.3, align: 'right' },
        { share: 0.4, align: 'left' },
      ],
      4: [
        { share: 0.16, align: 'left' },
        { share: 0.42, align: 'left' },
        { share: 0.18, align: 'right' },
        { share: 0.24, align: 'left' },
      ],
    };
    const gap = labels.length === 3 ? 24 : 12;
    let offset = left;
    const layout = layouts[labels.length] ?? layouts[3];
    const columns = layout.map((column, index) => {
      const x = offset;
      offset += width * column.share;
      // Todas menos la última dejan un hueco con la siguiente: sin él, un número alineado a la derecha se pega al texto de al lado.
      return {
        label: labels[index],
        x,
        width: width * column.share - (index < layout.length - 1 ? gap : 0),
        align: column.align,
      };
    });
    const header = () => {
      doc.font(FONT.bold).fontSize(9.5).fillColor(COLORS.text);
      const y = doc.y;
      for (const column of columns)
        doc.text(column.label, column.x, y, {
          width: column.width,
          align: column.align,
          lineBreak: false,
        });
      doc.y = y + ROW_HEIGHT - 2;
      doc
        .moveTo(left, doc.y)
        .lineTo(left + width, doc.y)
        .lineWidth(0.7)
        .strokeColor(COLORS.text)
        .stroke();
      doc.y += 4;
    };

    if (rows.length === 0) {
      doc
        .font(FONT.italic)
        .fontSize(BODY_SIZE)
        .text(
          'No constan propiedades presentes ni representadas.',
          left,
          doc.y,
          { width },
        );
      doc.moveDown(0.6);
      return;
    }
    // Cabecera + al menos dos filas juntas; la cabecera se repite en cada página.
    ensureSpace(ROW_HEIGHT * 4);
    header();
    for (const row of rows) {
      doc.font(FONT.regular).fontSize(10).fillColor(COLORS.text);
      const cells = row.map(pdfText);
      // Un nombre largo («X, en representación de Y») baja a más líneas en su celda: la fila crece.
      const rowHeight =
        Math.max(
          ROW_HEIGHT - 3,
          ...cells.map((cell, index) =>
            doc.heightOfString(cell, { width: columns[index].width }),
          ),
        ) + 1.5;
      if (doc.y + rowHeight > bottomLimit()) {
        doc.addPage();
        header();
        doc.font(FONT.regular).fontSize(10).fillColor(COLORS.text);
      }
      const y = doc.y;
      cells.forEach((cell, index) => {
        const column = columns[index];
        doc.text(cell, column.x, y, {
          width: column.width,
          align: column.align,
        });
      });
      doc.y = y + rowHeight;
    }
    doc
      .moveTo(left, doc.y + 1)
      .lineTo(left + width, doc.y + 1)
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .stroke();
    doc.y += 8;
  }

  private item(
    doc: PDFKit.PDFDocument,
    item: ActaItem,
    ctx: {
      left: number;
      width: number;
      paragraph: (
        text: string,
        opts?: {
          font?: string;
          size?: number;
          align?: 'left' | 'justify' | 'center';
          indent?: number;
          gap?: number;
        },
      ) => void;
      ensureSpace: (needed: number) => void;
      textHeight: (
        text: string,
        font: string,
        size: number,
        opts?: PDFKit.Mixins.TextOptions,
      ) => number;
    },
  ): void {
    const { left, width, paragraph, ensureSpace, textHeight } = ctx;
    const title = item.headingText;
    // El título del punto nunca se queda solo: se exige sitio para él y para lo que le sigue.
    const firstBody =
      item.narrative.text.split('\n')[0] ??
      item.stateText ??
      item.votes[0]?.question ??
      '';
    ensureSpace(
      textHeight(title, FONT.bold, BODY_SIZE) +
        Math.min(textHeight(firstBody, FONT.regular, BODY_SIZE), 60) +
        16,
    );
    doc.moveDown(0.6);
    doc
      .font(FONT.bold)
      .fontSize(BODY_SIZE)
      .fillColor(COLORS.text)
      .text(pdfText(title), left, doc.y, { width });
    doc.moveDown(0.3);

    for (const part of item.narrative.text
      ? item.narrative.text.split('\n')
      : [])
      paragraph(part, { align: 'justify' });
    if (item.stateText) paragraph(item.stateText, { font: FONT.italic });
    for (const vote of item.votes) this.vote(doc, vote, ctx);
    for (const agreement of item.agreements) {
      paragraph(agreement.line, { font: FONT.bold, gap: 0.5 });
    }
  }

  private vote(
    doc: PDFKit.PDFDocument,
    vote: ActaVoteBlock,
    ctx: {
      left: number;
      paragraph: (
        text: string,
        opts?: {
          font?: string;
          size?: number;
          align?: 'left' | 'justify' | 'center';
          indent?: number;
          gap?: number;
        },
      ) => void;
      ensureSpace: (needed: number) => void;
    },
  ): void {
    const { paragraph, ensureSpace } = ctx;
    // El bloque de votación (propuesta, opciones y resultado) se mantiene junto.
    ensureSpace(34 + vote.options.length * 15 + 40);
    if (vote.lines.question) paragraph(vote.lines.question, { gap: 0.3 });
    for (const option of vote.lines.options)
      paragraph(option, { indent: 18, gap: 0.1 });
    paragraph(vote.lines.majority, { gap: 0.3 });
    if (vote.lines.favorable) paragraph(vote.lines.favorable, { gap: 0.3 });
    if (vote.lines.outcome)
      paragraph(vote.lines.outcome, { font: FONT.bold, gap: 0.5 });
  }

  private signatures(
    doc: PDFKit.PDFDocument,
    model: ActaDocumentModel,
    left: number,
    width: number,
    ensureSpace: (needed: number) => void,
  ): void {
    const blockHeight = 150;
    ensureSpace(blockHeight);
    doc.moveDown(2);
    const top = doc.y;
    const columnWidth = (width - 30) / 2;
    model.signatures.blocks.forEach((block, index) => {
      const x = left + index * (columnWidth + 30);
      let y = top;
      doc.font(FONT.bold).fontSize(10).fillColor(COLORS.text);
      for (const line of block.lines) {
        doc.text(pdfText(line), x, y, {
          width: columnWidth,
          align: 'center',
          lineBreak: false,
        });
        y += 13;
      }
      // Hueco para la firma.
      const lineY = top + 90;
      doc
        .moveTo(x + 10, lineY)
        .lineTo(x + columnWidth - 10, lineY)
        .lineWidth(0.6)
        .strokeColor(COLORS.text)
        .stroke();
    });
    doc.y = top + 100;
  }

  private decoratePages(
    doc: PDFKit.PDFDocument,
    model: ActaDocumentModel,
    options: ActaPdfOptions,
    left: number,
    width: number,
  ): void {
    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      doc.switchToPage(range.start + index);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // escribir en el margen inferior no debe provocar otra página
      doc.fillColor(COLORS.muted).font(FONT.regular).fontSize(8);
      if (index > 0) {
        doc.text(
          pdfText(`${model.header.communityName} — ${model.header.title}`),
          left,
          40,
          { width, align: 'left', lineBreak: false },
        );
        doc
          .moveTo(left, 54)
          .lineTo(left + width, 54)
          .lineWidth(0.3)
          .strokeColor(COLORS.line)
          .stroke();
      }
      const footerY = doc.page.height - 44;
      if (options.footerNote)
        doc.text(pdfText(options.footerNote), left, footerY, {
          width: width * 0.7,
          align: 'left',
          lineBreak: false,
        });
      doc.text(`Página ${index + 1} de ${range.count}`, left, footerY, {
        width,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = bottomMargin;
    }
  }
}
