import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * Informe en forma de tablas, independiente del formato de salida: los
 * modelos fiscales (fase 7b) y los informes contables (fase 12) se
 * describen así una vez y se entregan en Excel o PDF.
 */
export type CellKind = 'text' | 'money' | 'int';

export interface ReportColumn {
  key: string;
  header: string;
  kind?: CellKind;
  /** Peso relativo del ancho (1 por defecto). */
  width?: number;
}

export type ReportCell = string | number | null | undefined;

export interface ReportSection {
  title?: string;
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** Fila final en negrita. */
  totals?: Record<string, ReportCell>;
  /** Texto si la sección no tiene filas. */
  empty?: string;
}

export interface TableReport {
  title: string;
  /** Líneas bajo el título: finca, CIF, periodo… */
  subtitle?: string[];
  sections: ReportSection[];
  /** Notas al pie: criterios, avisos, plazos. */
  notes?: string[];
  /** Nombre del fichero, sin extensión. */
  fileName: string;
}

const MONEY_FORMAT = '#,##0.00 "€"';

function money(value: number): string {
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })} €`;
}

function asText(value: ReportCell, kind: CellKind = 'text'): string {
  if (value === null || value === undefined || value === '') return '';
  if (kind === 'money' && typeof value === 'number') return money(value);
  return String(value);
}

function safeFileName(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'informe'
  );
}

export async function renderReportXlsx(
  report: TableReport,
): Promise<{ fileName: string; content: Buffer }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Domora';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(report.title.slice(0, 31));
  const maxCols = Math.max(1, ...report.sections.map((s) => s.columns.length));

  sheet.addRow([report.title]).font = { bold: true, size: 14 };
  for (const line of report.subtitle ?? [])
    sheet.addRow([line]).font = { color: { argb: 'FF555555' } };

  for (const section of report.sections) {
    sheet.addRow([]);
    if (section.title)
      sheet.addRow([section.title]).font = { bold: true, size: 12 };
    const header = sheet.addRow(section.columns.map((c) => c.header));
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8E8E8' },
      };
    });
    const writeRow = (values: Record<string, ReportCell>, bold = false) => {
      const row = sheet.addRow(
        section.columns.map((c) => values[c.key] ?? null),
      );
      section.columns.forEach((c, i) => {
        if (c.kind === 'money') row.getCell(i + 1).numFmt = MONEY_FORMAT;
      });
      if (bold) row.font = { bold: true };
    };
    if (section.rows.length === 0 && section.empty)
      sheet.addRow([section.empty]).font = { italic: true };
    for (const r of section.rows) writeRow(r);
    if (section.totals) writeRow(section.totals, true);
  }
  if (report.notes?.length) {
    sheet.addRow([]);
    for (const n of report.notes)
      sheet.addRow([n]).font = { italic: true, color: { argb: 'FF555555' } };
  }
  for (let i = 1; i <= maxCols; i++)
    sheet.getColumn(i).width = i === 1 ? 30 : 18;

  return {
    fileName: `${safeFileName(report.fileName)}.xlsx`,
    content: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}

const PDF = {
  margin: 40,
  text: '#1a1a1a',
  muted: '#6b7280',
  line: '#d1d5db',
  fill: '#f3f4f6',
};

export function renderReportPdf(
  report: TableReport,
): Promise<{ fileName: string; content: Buffer }> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PDF.margin,
      info: { Title: report.title, Creator: 'Domora' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () =>
      resolve({
        fileName: `${safeFileName(report.fileName)}.pdf`,
        content: Buffer.concat(chunks),
      }),
    );

    const left = PDF.margin;
    const width = doc.page.width - PDF.margin * 2;
    const bottom = () => doc.page.height - PDF.margin;
    const ensure = (h: number) => {
      if (doc.y + h > bottom()) doc.addPage();
    };

    doc
      .fillColor(PDF.text)
      .font('Helvetica-Bold')
      .fontSize(15)
      .text(report.title, left, doc.y, { width });
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9).fillColor(PDF.muted);
    for (const line of report.subtitle ?? []) doc.text(line, { width });
    doc.moveDown(0.8);

    for (const section of report.sections) {
      ensure(40);
      if (section.title) {
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor(PDF.text)
          .text(section.title, left, doc.y, { width });
        doc.moveDown(0.3);
      }
      const weights = section.columns.map((c) => c.width ?? 1);
      const total = weights.reduce((s, w) => s + w, 0);
      const widths = weights.map((w) => (w / total) * width);
      const xs = widths.map(
        (_, i) => left + widths.slice(0, i).reduce((s, w) => s + w, 0),
      );

      const drawRow = (
        values: Record<string, ReportCell> | null,
        opts: { header?: boolean; bold?: boolean } = {},
      ) => {
        doc
          .font(opts.header || opts.bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5);
        const cells = section.columns.map((c) =>
          values ? asText(values[c.key], c.kind) : c.header,
        );
        const height =
          Math.max(
            ...cells.map((t, i) =>
              doc.heightOfString(t || ' ', { width: widths[i] - 6 }),
            ),
          ) + 6;
        ensure(height);
        const y = doc.y;
        if (opts.header) doc.rect(left, y, width, height).fill(PDF.fill);
        doc.fillColor(PDF.text);
        cells.forEach((t, i) => {
          const align =
            section.columns[i].kind && section.columns[i].kind !== 'text'
              ? 'right'
              : 'left';
          doc.text(t, xs[i] + 3, y + 3, { width: widths[i] - 6, align });
        });
        doc
          .moveTo(left, y + height)
          .lineTo(left + width, y + height)
          .strokeColor(PDF.line)
          .lineWidth(0.5)
          .stroke();
        doc.x = left;
        doc.y = y + height;
      };

      drawRow(null, { header: true });
      if (section.rows.length === 0 && section.empty) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(8.5)
          .fillColor(PDF.muted)
          .text(section.empty, left + 3, doc.y + 4, { width: width - 6 });
        doc.moveDown(0.5);
      }
      for (const r of section.rows) drawRow(r);
      if (section.totals) drawRow(section.totals, { bold: true });
      doc.moveDown(1);
    }

    if (report.notes?.length) {
      ensure(30);
      doc.font('Helvetica').fontSize(8).fillColor(PDF.muted);
      for (const n of report.notes)
        doc.text(n, left, doc.y, { width }).moveDown(0.3);
    }
    doc.end();
  });
}
