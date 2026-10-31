import { validateRemesaRow } from './remesa-import.validator';

function baseRow(
  overrides: Record<string, string> = {},
): Record<string, string> {
  return {
    remesaRef: 'REM-AGO-2026',
    periodKey: '2026-08',
    receiptNo: '2026/08-001',
    amount: '120,00',
    status: 'Cobrado',
    ...overrides,
  };
}

describe('validateRemesaRow', () => {
  it('acepta una fila completa y válida, con secuencia y esquema por defecto', () => {
    const result = validateRemesaRow(baseRow(), 2);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      remesaRef: 'REM-AGO-2026',
      periodKey: '2026-08',
      receiptNo: '2026/08-001',
      amount: 120,
      status: 'Cobrado',
      mandateSeq: 'RCUR',
      scheme: 'CORE',
    });
  });

  it('sin secuencia SEPA en el origen: avisa y asume RCUR', () => {
    const result = validateRemesaRow(baseRow(), 2);
    expect(result.warnings.some((w) => w.includes('RCUR'))).toBe(true);
  });

  it('respeta la secuencia y el esquema si vienen mapeados', () => {
    const result = validateRemesaRow(
      baseRow({ mandateSeq: 'FRST', scheme: 'B2B' }),
      2,
    );
    expect(result.data?.mandateSeq).toBe('FRST');
    expect(result.data?.scheme).toBe('B2B');
    expect(result.warnings).toHaveLength(0);
  });

  it('secuencia SEPA no reconocida: bloquea con error', () => {
    const result = validateRemesaRow(baseRow({ mandateSeq: 'XXXX' }), 2);
    expect(result.ok).toBe(false);
  });

  it('faltan campos obligatorios: bloquea con un error por campo', () => {
    const result = validateRemesaRow({}, 2);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(5);
  });

  it('fechas de presentación/cargo opcionales, en formato español', () => {
    const result = validateRemesaRow(
      baseRow({ presentedAt: '28/08/2026', chargeDate: '01/09/2026' }),
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.data?.presentedAt?.toISOString().slice(0, 10)).toBe(
      '2026-08-28',
    );
    expect(result.data?.chargeDate?.toISOString().slice(0, 10)).toBe(
      '2026-09-01',
    );
  });
});
