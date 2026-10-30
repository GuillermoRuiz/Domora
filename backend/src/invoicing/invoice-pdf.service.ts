import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AdminInvoice } from '../prisma/client';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import {
  QR_ERROR_CORRECTION,
  QR_QUIET_ZONE_MM,
  QR_SIZE_MM,
  VERIFACTU_LEGEND,
  VERIFACTU_LEGEND_LONG,
  buildQrUrl,
} from '../verifactu/verifactu-qr';

/** pdfkit trabaja en puntos PostScript: 1 mm = 72/25.4 pt. */
const MM = 72 / 25.4;

const COLORS = {
  text: '#1a1a1a',
  muted: '#6b7280',
  line: '#d1d5db',
  accent: '#0f766e',
};

/**
 * Genera el PDF de una factura.
 *
 * Cubre los campos obligatorios del RD 1619/2012 (número y serie, fechas de
 * expedición y operación, identificación completa de ambas partes,
 * descripción, base imponible, tipo y cuota) y, por ser un sistema
 * VERI\*FACTU, el código QR de cotejo y la leyenda que lo anuncia.
 *
 * El PDF se genera al vuelo y no se almacena: los datos fiscales ya viven en
 * la factura, que es inmutable, así que el documento siempre se puede
 * reproducir idéntico. Guardar una copia solo añadiría una fuente de verdad
 * que podría divergir.
 */
@Injectable()
export class InvoicePdfService {
  constructor(private readonly config: ConfigService) {}

  private issuer() {
    return {
      name: this.config.getOrThrow<string>('INVOICE_ISSUER_NAME'),
      taxId: this.config.getOrThrow<string>('INVOICE_ISSUER_TAX_ID'),
      address: this.config.getOrThrow<string>('INVOICE_ISSUER_ADDRESS'),
    };
  }

  private static eur(value: { toFixed(n: number): string }): string {
    return `${value.toFixed(2)} €`;
  }

  private static date(value: Date): string {
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${value.getUTCFullYear()}`;
  }

  /**
   * Pinta el QR como rectángulos vectoriales, un módulo cada uno.
   *
   * `qrcode` devuelve la matriz como un array plano de bits, de lado
   * `modules.size`. Se dibuja módulo a módulo en lugar de incrustar un PNG:
   * sale nítido a cualquier resolución de impresión y evita la codificación
   * PNG, que era con diferencia lo más lento de generar la factura.
   */
  private static drawQr(
    doc: PDFKit.PDFDocument,
    qr: QRCode.QRCode,
    x: number,
    y: number,
    side: number,
  ): void {
    const size = qr.modules.size;
    const cell = side / size;
    doc.save().fillColor('#000000');
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.modules.get(row, col)) {
          // +0.5 de solape: evita las hairlines blancas entre módulos que
          // algunos visores dejan al redondear coordenadas.
          doc.rect(x + col * cell, y + row * cell, cell + 0.5, cell + 0.5);
        }
      }
    }
    doc.fill().restore();
  }

  /**
   * @param options.compress Comprimir el flujo de contenido. Por defecto sí:
   * medido sobre una factura real, comprimir la deja en ~3,6 KB frente a
   * ~23 KB. Se puede desactivar para poder leer el contenido del PDF en las
   * pruebas sin necesidad de un parser completo, ejercitando exactamente el
   * mismo código de composición.
   */
  async render(
    invoice: AdminInvoice,
    options: { compress?: boolean } = {},
  ): Promise<Buffer> {
    const issuer = this.issuer();

    const qrUrl = buildQrUrl({
      issuerTaxId: issuer.taxId,
      invoiceNo: invoice.invoiceNo,
      issueDate: invoice.issueDate,
      total: invoice.total.toFixed(2),
    });
    // Solo la matriz de módulos, no un PNG: se dibuja como vectores (ver
    // drawQr). Codificar el PNG costaba ~3,7 s frente a los ~11 ms de esto, y
    // además un QR vectorial sale nítido a cualquier tamaño de impresión, que
    // es justo lo que importa en un código que hay que escanear en papel.
    const qr = QRCode.create(qrUrl, {
      errorCorrectionLevel: QR_ERROR_CORRECTION,
    });

    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      compress: options.compress ?? true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    // ── Cabecera: QR arriba, como exige la norma ────────────────────────
    const qrSide = QR_SIZE_MM * MM;
    const qrX = right - qrSide;
    InvoicePdfService.drawQr(doc, qr, qrX, 45, qrSide);
    doc
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(VERIFACTU_LEGEND, qrX, 45 + qrSide + QR_QUIET_ZONE_MM * MM, {
        width: qrSide,
        align: 'center',
      });

    doc
      .fontSize(20)
      .fillColor(COLORS.accent)
      .text('FACTURA', left, 50)
      .fontSize(11)
      .fillColor(COLORS.text)
      .text(invoice.invoiceNo, left, 76);

    doc
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(
        `Fecha de expedición: ${InvoicePdfService.date(invoice.issueDate)}`,
        left,
        96,
      )
      .text(
        `Fecha de operación: ${InvoicePdfService.date(invoice.operationDate)}`,
        left,
        109,
      );

    // ── Emisor y destinatario ───────────────────────────────────────────
    const partiesY = 150;
    const colWidth = (right - left) / 2 - 10;

    doc.fontSize(8).fillColor(COLORS.muted).text('EMISOR', left, partiesY);
    doc
      .fontSize(9)
      .fillColor(COLORS.text)
      .text(issuer.name, left, partiesY + 14, { width: colWidth })
      .text(`NIF: ${issuer.taxId}`, { width: colWidth })
      .text(issuer.address, { width: colWidth });

    const rightCol = left + colWidth + 20;
    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text('DESTINATARIO', rightCol, partiesY);
    doc
      .fontSize(9)
      .fillColor(COLORS.text)
      .text(invoice.recipientName, rightCol, partiesY + 14, { width: colWidth })
      .text(`NIF: ${invoice.recipientTaxId}`, { width: colWidth })
      .text(invoice.recipientAddress || '—', { width: colWidth });

    // ── Detalle ─────────────────────────────────────────────────────────
    const tableY = 250;
    doc
      .moveTo(left, tableY)
      .lineTo(right, tableY)
      .strokeColor(COLORS.line)
      .stroke();

    doc
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text('CONCEPTO', left, tableY + 10)
      .text('IMPORTE', right - 100, tableY + 10, {
        width: 100,
        align: 'right',
      });

    doc
      .fontSize(10)
      .fillColor(COLORS.text)
      .text(invoice.concept || 'Servicios prestados', left, tableY + 28, {
        width: right - left - 120,
      })
      .text(InvoicePdfService.eur(invoice.taxBase), right - 100, tableY + 28, {
        width: 100,
        align: 'right',
      });

    // ── Totales: base, tipo y cuota desglosados, como exige la norma ────
    const totalsY = tableY + 70;
    doc
      .moveTo(left, totalsY)
      .lineTo(right, totalsY)
      .strokeColor(COLORS.line)
      .stroke();

    const rows: [string, string, boolean][] = [
      ['Base imponible', InvoicePdfService.eur(invoice.taxBase), false],
      [
        `IVA (${Number(invoice.taxRate).toFixed(0)}%)`,
        InvoicePdfService.eur(invoice.taxAmount),
        false,
      ],
      ['TOTAL', InvoicePdfService.eur(invoice.total), true],
    ];

    let y = totalsY + 12;
    for (const [label, value, strong] of rows) {
      doc
        .fontSize(strong ? 12 : 10)
        .fillColor(strong ? COLORS.text : COLORS.muted)
        .text(label, right - 260, y, { width: 150, align: 'right' })
        .fillColor(COLORS.text)
        .text(value, right - 100, y, { width: 100, align: 'right' });
      y += strong ? 22 : 18;
    }

    if (invoice.status === 'Anulada') {
      doc
        .fontSize(14)
        .fillColor('#b91c1c')
        .text('FACTURA ANULADA', left, y + 20, {
          width: right - left,
          align: 'center',
        });
      y += 40;
    }

    // ── Pie ─────────────────────────────────────────────────────────────
    const footerY = doc.page.height - doc.page.margins.bottom - 40;
    doc
      .fontSize(7)
      .fillColor(COLORS.muted)
      .text(VERIFACTU_LEGEND_LONG, left, footerY, {
        width: right - left,
        align: 'center',
      })
      .text(
        'Escanea el código QR para cotejar esta factura en la sede electrónica.',
        { width: right - left, align: 'center' },
      );

    doc.end();
    return finished;
  }
}
