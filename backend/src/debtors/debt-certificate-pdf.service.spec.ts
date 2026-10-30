import { Prisma } from '../prisma/client';
import { DebtCertificatePdfService } from './debt-certificate-pdf.service';
import type { DebtorsService } from './debtors.service';

type Certificate = Awaited<ReturnType<DebtorsService['debtCertificate']>>;

function receipt(
  overrides: Partial<Certificate['pendingReceipts'][number]> = {},
): Certificate['pendingReceipts'][number] {
  return {
    id: 'r1',
    no: '2026/06-1',
    period: 'Junio 2026',
    concept: 'Cuota ordinaria junio 2026',
    amount: new Prisma.Decimal('100.00'),
    outstanding: new Prisma.Decimal('100.00'),
    originYear: 2026,
    isInterest: false,
    status: 'Pendiente',
    dueDate: new Date('2026-06-10T00:00:00Z'),
    ...overrides,
  };
}

function certificate(overrides: Partial<Certificate> = {}): Certificate {
  const affected = [receipt()];
  return {
    issuedAt: '2026-09-30T10:00:00.000Z',
    issuedByUserId: 'user-1',
    legalBasis:
      'Art. 9.1.e LPH — certificado de estado de deudas con la comunidad',
    estate: { id: 'estate-1', name: 'Comunidad Prueba 12', cif: 'H12345678' },
    property: {
      id: 'prop-1',
      ref: null,
      staircase: '1',
      floor: '2',
      door: 'A',
    },
    pendingReceipts: affected,
    principal: new Prisma.Decimal('100.00'),
    interest: new Prisma.Decimal('0'),
    totalDebt: new Prisma.Decimal('100.00'),
    activeAgreement: null,
    isDebtFree: false,
    article91e: {
      currentYear: 2026,
      cutoffYear: 2023,
      receipts: affected,
      principal: new Prisma.Decimal('100.00'),
      interest: new Prisma.Decimal('0'),
    },
    priorYears: {
      receipts: [],
      principal: new Prisma.Decimal('0'),
      interest: new Prisma.Decimal('0'),
    },
    ...overrides,
  };
}

/**
 * Renderiza sin comprimir y devuelve el contenido como texto — mismo
 * truco que `invoice-pdf.service.spec.ts`: pdfkit escribe los literales en
 * hexadecimal dentro de los operadores TJ, partidos por el kerning.
 */
const pdf = new DebtCertificatePdfService();

async function renderText(cert: Certificate): Promise<string> {
  const buffer = await pdf.render(cert, { compress: false });
  const raw = buffer.toString('latin1');
  return (raw.match(/<([0-9A-Fa-f]+)>/g) ?? [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), 'hex').toString('latin1'))
    .join('');
}

describe('DebtCertificatePdfService', () => {
  it('produce un PDF válido', async () => {
    const buffer = await pdf.render(certificate());
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('incluye la comunidad, la propiedad y el importe de la deuda', async () => {
    const text = await renderText(certificate());
    expect(text).toContain('Comunidad Prueba 12');
    expect(text).toContain('H12345678');
    expect(text).toContain('100.00');
  });

  it('deja las líneas de firma para el secretario y el visto bueno del presidente', async () => {
    const text = await renderText(certificate());
    expect(text).toContain('Secretario');
    expect(text).toContain('Presidente');
  });

  it('avisa de que es un borrador sin las firmas', async () => {
    const text = await renderText(certificate());
    expect(text).toContain('borrador');
  });

  it('sin deuda, muestra el mensaje claro en vez de una tabla vacía', async () => {
    const text = await renderText(
      certificate({
        pendingReceipts: [],
        principal: new Prisma.Decimal(0),
        interest: new Prisma.Decimal(0),
        totalDebt: new Prisma.Decimal(0),
        isDebtFree: true,
        article91e: {
          currentYear: 2026,
          cutoffYear: 2023,
          receipts: [],
          principal: new Prisma.Decimal(0),
          interest: new Prisma.Decimal(0),
        },
      }),
    );
    expect(text).toContain('SIN DEUDA PENDIENTE');
  });

  it('con deuda de ejercicios anteriores, la separa de la que afecta a la transmisión', async () => {
    const oldReceipt = receipt({
      id: 'r2',
      originYear: 2018,
      concept: 'Cuota ordinaria 2018',
      outstanding: new Prisma.Decimal('50.00'),
    });
    const text = await renderText(
      certificate({
        principal: new Prisma.Decimal('150.00'),
        totalDebt: new Prisma.Decimal('150.00'),
        priorYears: {
          receipts: [oldReceipt],
          principal: new Prisma.Decimal('50.00'),
          interest: new Prisma.Decimal('0'),
        },
      }),
    );
    expect(text).toContain('ejercicios anteriores');
    expect(text).toContain('Cuota ordinaria 2018');
  });
});
