import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { DebtorsService } from './debtors.service';

type Certificate = Awaited<ReturnType<DebtorsService['debtCertificate']>>;

const COLORS = {
  text: '#1a1a1a',
  muted: '#6b7280',
  line: '#d1d5db',
  accent: '#0f766e',
  warn: '#b91c1c',
};

function eur(value: { toFixed(n: number): string }): string {
  return `${value.toFixed(2)} €`;
}

function date(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${d.getUTCFullYear()}`;
}

function propertyLabel(p: Certificate['property']): string {
  return p.ref ?? [p.staircase, p.floor, p.door].filter(Boolean).join('-');
}

/**
 * Certificado de deuda (art. 9.1.e LPH) en PDF, con firmas — ADR D22: PDF
 * borrador para que firme el secretario, con el visto bueno del presidente;
 * separa la deuda que afecta a la transmisión (año en curso + 3 años
 * naturales anteriores) de la anterior, y muestra intereses aparte sin que
 * sumen a la cantidad legal. No se persiste: se reproduce al vuelo desde
 * `DebtorsService.debtCertificate()`, que ya trae los datos agrupados.
 *
 * Domora no modela "secretario"/"presidente" como cuentas reales (son
 * etiquetas libres, igual que en las actas de junta) — las firmas quedan en
 * blanco para firmar a mano.
 */
@Injectable()
export class DebtCertificatePdfService {
  /**
   * @param options.compress Comprimir el flujo de contenido (por defecto
   * sí). Se puede desactivar para poder leer el contenido del PDF en las
   * pruebas sin un parser completo — mismo motivo que `InvoicePdfService`.
   */
  async render(
    cert: Certificate,
    options: { compress?: boolean } = {},
  ): Promise<Buffer> {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      compress: options.compress ?? true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const finished = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    this.header(doc, cert, left, width);
    this.propertyBlock(doc, cert, left, width);

    if (cert.isDebtFree) {
      doc.moveDown(2);
      doc
        .fontSize(13)
        .fillColor(COLORS.accent)
        .text('SIN DEUDA PENDIENTE CON LA COMUNIDAD', left, doc.y, {
          width,
          align: 'center',
        });
    } else {
      this.section(
        doc,
        left,
        width,
        `Deuda que afecta a la transmisión — art. 9.1.e LPH (${cert.article91e.cutoffYear}-${cert.article91e.currentYear})`,
        cert.article91e.receipts,
        cert.article91e.principal,
        cert.article91e.interest,
      );
      doc
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(
          `La cantidad de la que responde el inmueble por el art. 9.1.e LPH es de ${eur(cert.article91e.principal)} ` +
            '(solo principal; los intereses se muestran a título informativo, pero no computan a estos efectos).',
          left,
          doc.y + 4,
          { width },
        );

      if (cert.priorYears.receipts.length > 0) {
        doc.moveDown(1.5);
        this.section(
          doc,
          left,
          width,
          'Deuda de ejercicios anteriores (no afecta a la transmisión)',
          cert.priorYears.receipts,
          cert.priorYears.principal,
          cert.priorYears.interest,
        );
      }

      if (cert.activeAgreement) {
        doc.moveDown(1);
        doc
          .fontSize(9)
          .fillColor(COLORS.text)
          .text(
            'Existe un acuerdo de pago vigente sobre parte de esta deuda, con cuotas pendientes de vencer.',
            left,
            doc.y,
            { width },
          );
      }
    }

    this.signatures(doc, cert, left, right, width);
    this.footer(doc, left, width);

    doc.end();
    return finished;
  }

  private header(
    doc: PDFKit.PDFDocument,
    cert: Certificate,
    left: number,
    width: number,
  ): void {
    doc
      .fontSize(18)
      .fillColor(COLORS.accent)
      .text('Certificado de deuda', left, 50)
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(cert.legalBasis, left, doc.y + 2, { width });

    doc.moveDown(0.8);
    doc
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(`Emitido el ${date(cert.issuedAt)}.`, left, doc.y, { width });
  }

  private propertyBlock(
    doc: PDFKit.PDFDocument,
    cert: Certificate,
    left: number,
    width: number,
  ): void {
    doc.moveDown(1);
    doc.fontSize(8).fillColor(COLORS.muted).text('COMUNIDAD', left, doc.y);
    doc
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(cert.estate.name, left, doc.y + 2, { width })
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(`CIF: ${cert.estate.cif}`, left, doc.y, { width });

    doc.moveDown(0.8);
    doc.fontSize(8).fillColor(COLORS.muted).text('PROPIEDAD', left, doc.y);
    doc
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(propertyLabel(cert.property), left, doc.y + 2, { width });
  }

  /** Una sección: título, tabla de recibos y totales de principal/intereses. */
  private section(
    doc: PDFKit.PDFDocument,
    left: number,
    width: number,
    title: string,
    receipts: Certificate['pendingReceipts'],
    principal: { toFixed(n: number): string },
    interest: { toFixed(n: number): string },
  ): void {
    doc.moveDown(1);
    doc.fontSize(11).fillColor(COLORS.text).text(title, left, doc.y, { width });
    doc.moveDown(0.3);

    const colYear = 50;
    const colConcept = width - 50 - 90 - 90;
    const colAmount = 90;

    const headerY = doc.y;
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text('AÑO', left, headerY, { width: colYear })
      .text('CONCEPTO', left + colYear, headerY, { width: colConcept })
      .text('TIPO', left + colYear + colConcept, headerY, {
        width: colAmount,
      })
      .text('PENDIENTE', left + colYear + colConcept + colAmount, headerY, {
        width: colAmount,
        align: 'right',
      });
    doc
      .moveTo(left, doc.y + 12)
      .lineTo(left + width, doc.y + 12)
      .strokeColor(COLORS.line)
      .stroke();
    doc.moveDown(1.2);

    if (receipts.length === 0) {
      doc
        .fontSize(9)
        .fillColor(COLORS.muted)
        .text('Sin partidas en este tramo.', left, doc.y, { width });
    }
    for (const r of receipts) {
      const rowY = doc.y;
      doc
        .fontSize(9)
        .fillColor(COLORS.text)
        .text(String(r.originYear), left, rowY, { width: colYear })
        .text(r.concept, left + colYear, rowY, { width: colConcept })
        .text(
          r.isInterest ? 'Interés' : 'Principal',
          left + colYear + colConcept,
          rowY,
          { width: colAmount },
        )
        .text(
          eur(r.outstanding),
          left + colYear + colConcept + colAmount,
          rowY,
          { width: colAmount, align: 'right' },
        );
      doc.moveDown(0.5);
    }

    doc.moveDown(0.3);
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .strokeColor(COLORS.line)
      .stroke();
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor(COLORS.text)
      .text(`Principal: ${eur(principal)}`, left, doc.y, {
        width: width / 2,
      });
    doc
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(`Intereses: ${eur(interest)}`, left + width / 2, doc.y - 12, {
        width: width / 2,
        align: 'right',
      });
  }

  private signatures(
    doc: PDFKit.PDFDocument,
    cert: Certificate,
    left: number,
    right: number,
    width: number,
  ): void {
    // Nunca en la misma página que el pie si ya no queda sitio.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 140) {
      doc.addPage();
    }
    doc.moveDown(2.5);
    doc
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(`En ${cert.estate.name}, a ${date(new Date())}.`, left, doc.y, {
        width,
      });
    doc.moveDown(3);

    const colWidth = width / 2 - 20;
    const lineY = doc.y;
    doc
      .moveTo(left, lineY)
      .lineTo(left + colWidth, lineY)
      .strokeColor(COLORS.line)
      .stroke();
    doc
      .moveTo(right - colWidth, lineY)
      .lineTo(right, lineY)
      .strokeColor(COLORS.line)
      .stroke();

    doc
      .fontSize(9)
      .fillColor(COLORS.text)
      .text('Firma del Secretario/a', left, lineY + 6, {
        width: colWidth,
        align: 'center',
      })
      .text('Vº Bº El Presidente/a', right - colWidth, lineY + 6, {
        width: colWidth,
        align: 'center',
      });
  }

  private footer(doc: PDFKit.PDFDocument, left: number, width: number): void {
    const footerY = doc.page.height - doc.page.margins.bottom - 24;
    doc
      .fontSize(7)
      .fillColor(COLORS.warn)
      .text(
        'Documento en borrador, pendiente de firma — sin las firmas anteriores no tiene validez como certificado.',
        left,
        footerY,
        { width, align: 'center' },
      );
  }
}
