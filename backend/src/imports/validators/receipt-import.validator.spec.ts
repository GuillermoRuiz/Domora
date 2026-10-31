import { validateReceiptRow } from './receipt-import.validator';

function baseRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    no: '2026/08-001',
    periodKey: '2026-08',
    propertyRef: 'A-101',
    ownerName: 'Juan Histórico',
    ownerTaxId: '11111111H',
    iban: 'ES76 2077 0024 0031 0257 5766',
    concept: 'Cuota agosto',
    amount: '120,00',
    status: 'Pagada',
    date: '01/08/2026',
    method: 'Transferencia',
    ...overrides,
  };
}

describe('validateReceiptRow', () => {
  it('acepta una fila completa y válida, con snapshots tal cual del origen', () => {
    const result = validateReceiptRow(baseRow(), 2);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      no: '2026/08-001',
      periodKey: '2026-08',
      propertyRef: 'A-101',
      ownerName: 'Juan Histórico',
      ownerTaxId: '11111111H',
      ownerTaxIdCountry: 'ES',
      concept: 'Cuota agosto',
      amount: 120,
      status: 'Pagada',
      method: 'Transferencia',
    });
  });

  it('el IBAN se normaliza sin espacios', () => {
    const result = validateReceiptRow(baseRow(), 2);
    expect(result.data?.iban).toBe('ES7620770024003102575766');
  });

  it('kind por defecto es "Cuota" si no viene mapeado', () => {
    expect(validateReceiptRow(baseRow(), 2).data?.kind).toBe('Cuota');
  });

  it('periodo con formato inválido: bloquea con error', () => {
    const result = validateReceiptRow(baseRow({ periodKey: 'agosto-2026' }), 2);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('formato inválido');
  });

  it('reconoce alias de estado y forma de pago en español', () => {
    expect(
      validateReceiptRow(baseRow({ status: 'cobrado' }), 2).data?.status,
    ).toBe('Pagada');
    expect(
      validateReceiptRow(baseRow({ method: 'domiciliado' }), 2).data?.method,
    ).toBe('Domiciliacion');
  });

  it('recibo domiciliado sin IBAN: avisa pero no bloquea', () => {
    const result = validateReceiptRow(
      baseRow({ method: 'Domiciliacion', iban: '' }),
      2,
    );
    expect(result.ok).toBe(true);
    expect(
      result.warnings.some((w) => w.includes('domiciliado sin IBAN')),
    ).toBe(true);
  });

  it('sin nombre de propietario: avisa pero no bloquea (el recibo se importa igual)', () => {
    const result = validateReceiptRow(baseRow({ ownerName: '' }), 2);
    expect(result.ok).toBe(true);
    expect(
      result.warnings.some((w) => w.includes('Sin nombre de propietario')),
    ).toBe(true);
  });

  it('faltan campos obligatorios: bloquea con un error por campo', () => {
    const result = validateReceiptRow({}, 2);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(6);
  });

  it('estado no reconocido: bloquea con error', () => {
    const result = validateReceiptRow(
      baseRow({ status: 'no-es-un-estado' }),
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Estado no reconocido'))).toBe(
      true,
    );
  });
});
