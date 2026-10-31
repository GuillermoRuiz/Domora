import { validateMovementRow } from './movement-import.validator';

describe('validateMovementRow', () => {
  it('acepta una fila completa y válida, con importe siempre en magnitud (sin signo)', () => {
    const result = validateMovementRow(
      {
        date: '01/08/2026',
        concept: 'Cuota agosto',
        accountCode: '700',
        type: 'ingreso',
        amount: '1.234,56',
      },
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      concept: 'Cuota agosto',
      accountCode: '700',
      type: 'income',
      amount: 1234.56,
    });
    expect(result.data?.date.toISOString().slice(0, 10)).toBe('2026-08-01');
  });

  it('reconoce alias en español para el tipo (gasto/traspaso)', () => {
    expect(
      validateMovementRow(
        {
          date: '2026-08-01',
          concept: 'x',
          accountCode: '622',
          type: 'gasto',
          amount: '10',
        },
        2,
      ).data?.type,
    ).toBe('expense');
    expect(
      validateMovementRow(
        {
          date: '2026-08-01',
          concept: 'x',
          accountCode: '113',
          type: 'traspaso',
          amount: '10',
        },
        2,
      ).data?.type,
    ).toBe('transfer');
  });

  it('acepta fecha ISO y fecha española indistintamente', () => {
    expect(
      validateMovementRow(
        {
          date: '2026-08-01',
          concept: 'x',
          accountCode: '700',
          type: 'income',
          amount: '10',
        },
        2,
      ).ok,
    ).toBe(true);
    expect(
      validateMovementRow(
        {
          date: '01-08-2026',
          concept: 'x',
          accountCode: '700',
          type: 'income',
          amount: '10',
        },
        2,
      ).ok,
    ).toBe(true);
  });

  it('un importe negativo en el origen se normaliza a magnitud positiva (el signo lo aplica el commit según el tipo)', () => {
    const result = validateMovementRow(
      {
        date: '01/08/2026',
        concept: 'x',
        accountCode: '622',
        type: 'gasto',
        amount: '-30',
      },
      2,
    );
    expect(result.data?.amount).toBe(30);
  });

  it('falta cualquier campo obligatorio: bloquea con un error por campo', () => {
    const result = validateMovementRow({}, 2);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(5);
  });

  it('tipo no reconocido: bloquea con error', () => {
    const result = validateMovementRow(
      {
        date: '01/08/2026',
        concept: 'x',
        accountCode: '700',
        type: 'no-es-un-tipo',
        amount: '10',
      },
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('no reconocido');
  });

  it('fecha inválida: bloquea con error', () => {
    const result = validateMovementRow(
      {
        date: '32/13/2026',
        concept: 'x',
        accountCode: '700',
        type: 'income',
        amount: '10',
      },
      2,
    );
    expect(result.ok).toBe(false);
  });
});
