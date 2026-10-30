import PDFDocument from 'pdfkit';

export interface PdfTable {
  headers: string[];
  rows: string[][];
}

export interface MakePdfInput {
  title: string;
  /** Membrete opcional (nombre de la comunidad). */
  subtitle?: string;
  lines?: string[];
  tables?: PdfTable[];
  /** Fecha de creación incrustada: usar la ancla del seed para ser determinista. */
  creationDate: Date;
}

/**
 * PDF determinista: sin compresión, CreationDate/ModDate fijos y fuentes
 * estándar (no embebidas). Misma entrada = mismos bytes.
 */
export function makePdf(input: MakePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      compress: false,
      info: {
        Title: input.title,
        Producer: 'Domora demo',
        Creator: 'Domora demo',
        CreationDate: input.creationDate,
        ModDate: input.creationDate,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (input.subtitle) {
      doc.font('Helvetica').fontSize(10).text(input.subtitle);
      doc.moveDown(0.5);
    }
    doc.font('Helvetica-Bold').fontSize(18).text(input.title);
    doc.moveDown();
    doc.font('Helvetica').fontSize(11);
    for (const line of input.lines ?? []) doc.text(line).moveDown(0.4);

    for (const table of input.tables ?? []) {
      doc.moveDown();
      const colW = (doc.page.width - 100) / Math.max(table.headers.length, 1);
      const drawRow = (cells: string[], bold: boolean) => {
        const y = doc.y;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
        cells.forEach((cell, i) =>
          doc.text(cell, 50 + i * colW, y, { width: colW - 6 }),
        );
        doc.y = y + 16;
        doc.x = 50;
      };
      drawRow(table.headers, true);
      for (const row of table.rows) drawRow(row, false);
    }
    doc.end();
  });
}
