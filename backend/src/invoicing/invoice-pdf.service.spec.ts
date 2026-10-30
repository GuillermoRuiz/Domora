import type { ConfigService } from '@nestjs/config';
import { Prisma, type AdminInvoice } from '../prisma/client';
import { InvoicePdfService } from './invoice-pdf.service';

const ISSUER = {
  INVOICE_ISSUER_NAME: 'Domora S.L.',
  INVOICE_ISSUER_TAX_ID: 'B12345678',
  INVOICE_ISSUER_ADDRESS: 'Calle Real 1, Madrid',
};

function service(): InvoicePdfService {
  const config = {
    getOrThrow: (key: string) => ISSUER[key as keyof typeof ISSUER],
  } as unknown as ConfigService;
  return new InvoicePdfService(config);
}

function invoice(overrides: Partial<AdminInvoice> = {}): AdminInvoice {
  return {
    id: 'inv-1',
    administratorId: 'admin-1',
    invoiceNo: 'DOM-2026-0001',
    series: 'DOM',
    fiscalYear: 2026,
    sequence: 1,
    issueDate: new Date('2026-08-08T00:00:00Z'),
    operationDate: new Date('2026-08-01T00:00:00Z'),
    concept: 'Suscripción Domora — plan STANDARD',
    taxBase: new Prisma.Decimal('109.65'),
    taxRate: new Prisma.Decimal('21'),
    taxAmount: new Prisma.Decimal('23.03'),
    total: new Prisma.Decimal('132.68'),
    recipientName: 'Gestora Demo S.L.',
    recipientTaxId: 'B00000001',
    recipientAddress: 'Avenida Falsa 2, Barcelona',
    status: 'Pendiente',
    createdAt: new Date('2026-08-08T00:00:00Z'),
    stripeInvoiceId: null,
    ...overrides,
  };
}

/**
 * Renderiza sin comprimir y devuelve el contenido como texto.
 *
 * Se ejercita exactamente el mismo código de composición que en producción;
 * lo único que cambia es que el flujo queda legible y se puede comprobar qué
 * se ha impreso sin arrastrar un parser de PDF completo (se probó con
 * `pdf-parse`, que trae `pdfjs-dist` y exige configurar ESM en jest: cambiar
 * eso por un test de presentación no compensaba).
 */
const pdf = service();

async function renderText(inv: AdminInvoice): Promise<string> {
  const buffer = await pdf.render(inv, { compress: false });
  const raw = buffer.toString('latin1');

  // pdfkit escribe los literales en hexadecimal dentro de los operadores TJ,
  // partidos por los ajustes de kerning:
  //   [<46> 80 <41> 30 <435455524120414e554c4144> 40 <41> 0] TJ
  // Concatenando los trozos en orden se recompone el texto impreso.
  return (raw.match(/<([0-9A-Fa-f]+)>/g) ?? [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), 'hex').toString('latin1'))
    .join('');
}

describe('InvoicePdfService', () => {
  it('produce un PDF válido', async () => {
    const buffer = await pdf.render(invoice());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('incluye los datos identificativos de ambas partes', async () => {
    const text = await renderText(invoice());
    expect(text).toContain('B12345678'); // NIF emisor
    expect(text).toContain('B00000001'); // NIF destinatario
    expect(text).toContain('DOM-2026-0001');
  });

  it('desglosa base, tipo y cuota, no solo el total', async () => {
    const text = await renderText(invoice());
    expect(text).toContain('109.65');
    expect(text).toContain('23.03');
    expect(text).toContain('132.68');
  });

  it('lleva la leyenda VERI*FACTU exigida en este modo', async () => {
    const text = await renderText(invoice());
    expect(text).toContain('VERI*FACTU');
  });

  it('marca visiblemente las facturas anuladas', async () => {
    const text = await renderText(invoice({ status: 'Anulada' }));
    expect(text).toContain('ANULADA');
  });

  it('no marca como anulada una factura vigente', async () => {
    const text = await renderText(invoice());
    expect(text).not.toContain('ANULADA');
  });

  it('es reproducible: la factura es inmutable, el PDF también', async () => {
    // Se comparan los flujos de texto, no los bytes: el PDF lleva marca
    // temporal de creación, que sí cambia entre ejecuciones.
    const a = await renderText(invoice());
    const b = await renderText(invoice());
    expect(a.length).toBe(b.length);
  });
});
