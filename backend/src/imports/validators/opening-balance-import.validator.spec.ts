import { validateOpeningBalanceRow } from './opening-balance-import.validator';

describe('validateOpeningBalanceRow', () => {
  it('acepta una fila de banco, sin exigir concepto (no existe en OpeningBankBalanceDto)', () => {
    const result = validateOpeningBalanceRow(
      { tipo: 'banco', ref: 'Cuenta principal', amount: '1.234,56' },
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      tipo: 'banco',
      ref: 'Cuenta principal',
      amount: 1234.56,
    });
  });

  it('fila de banco sin alias: bloquea', () => {
    const result = validateOpeningBalanceRow(
      { tipo: 'banco', amount: '100' },
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('alias');
  });

  it('acepta una fila de deuda con año de origen y vencimiento', () => {
    const result = validateOpeningBalanceRow(
      {
        tipo: 'deuda',
        ref: 'A-101',
        concept: 'Cuotas 2024 pendientes',
        amount: '450',
        originYear: '2024',
        dueDate: '31/12/2024',
      },
      3,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      tipo: 'deuda',
      ref: 'A-101',
      originYear: 2024,
      amount: 450,
    });
    expect(result.data?.dueDate?.toISOString().slice(0, 10)).toBe('2024-12-31');
  });

  it('fila de deuda sin año de origen: bloquea', () => {
    const result = validateOpeningBalanceRow(
      { tipo: 'deuda', ref: 'A-101', concept: 'x', amount: '100' },
      3,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('año de origen'))).toBe(true);
  });

  it('año de origen fuera de rango: bloquea', () => {
    const result = validateOpeningBalanceRow(
      {
        tipo: 'deuda',
        ref: 'A-101',
        concept: 'x',
        amount: '100',
        originYear: '1850',
      },
      3,
    );
    expect(result.ok).toBe(false);
  });

  it('acepta una fila de anticipo', () => {
    const result = validateOpeningBalanceRow(
      { tipo: 'anticipo', ref: 'B-2', concept: 'Anticipo obras', amount: '80' },
      4,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      tipo: 'anticipo',
      ref: 'B-2',
      amount: 80,
    });
  });

  it('reconoce el alias en español y el código de cuenta para "otro"', () => {
    const porNombre = validateOpeningBalanceRow(
      {
        tipo: 'otro',
        concept: 'Retenciones pendientes',
        amount: '50',
        role: 'Retenciones',
        side: 'Haber',
      },
      5,
    );
    expect(porNombre.ok).toBe(true);
    expect(porNombre.data).toMatchObject({
      role: 'withholding_payable',
      side: 'credit',
    });

    const porCodigo = validateOpeningBalanceRow(
      {
        tipo: 'otro',
        concept: 'Fondo de reserva',
        amount: '50',
        role: '117',
        side: 'debe',
      },
      6,
    );
    expect(porCodigo.data?.role).toBe('reserve_fund');
    expect(porCodigo.data?.side).toBe('debit');
  });

  it('cuenta destino no reconocida para "otro": bloquea', () => {
    const result = validateOpeningBalanceRow(
      {
        tipo: 'otro',
        concept: 'x',
        amount: '50',
        role: 'no existe',
        side: 'debe',
      },
      5,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('no reconocida');
  });

  it('tipo no reconocido: bloquea', () => {
    const result = validateOpeningBalanceRow(
      { tipo: 'inventado', concept: 'x', amount: '10' },
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('no reconocido');
  });

  it('importe cero o negativo: bloquea', () => {
    expect(
      validateOpeningBalanceRow({ tipo: 'banco', ref: 'x', amount: '0' }, 2).ok,
    ).toBe(false);
    expect(
      validateOpeningBalanceRow({ tipo: 'banco', ref: 'x', amount: '-5' }, 2)
        .ok,
    ).toBe(false);
  });
});
