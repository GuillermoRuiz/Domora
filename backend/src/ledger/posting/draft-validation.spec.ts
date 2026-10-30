import { UnprocessableEntityException } from '@nestjs/common';
import { accountingDay, validateDraft } from './draft-validation';
import type { EntryDraft } from './posting.types';

function draft(
  lines: EntryDraft['lines'],
  overrides: Partial<EntryDraft> = {},
): EntryDraft {
  return {
    estateId: 'e1',
    date: new Date('2026-03-15T00:00:00Z'),
    sourceType: 'manual',
    concept: 'Prueba',
    lines,
    ...overrides,
  };
}

const bank = { role: 'bank' as const };
const fees = { role: 'bank_fees' as const };

describe('validateDraft', () => {
  it('acepta un asiento cuadrado de dos líneas', () => {
    expect(() =>
      validateDraft(
        draft([
          { account: fees, debit: 250 },
          { account: bank, credit: 250 },
        ]),
      ),
    ).not.toThrow();
  });

  it.each([
    ['una sola línea', [{ account: fees, debit: 250 }], /al menos dos líneas/],
    [
      'descuadrado',
      [
        { account: fees, debit: 250 },
        { account: bank, credit: 249 },
      ],
      /no cuadra.*2\.50.*2\.49/,
    ],
    [
      'línea con debe y haber a la vez',
      [
        { account: fees, debit: 250, credit: 250 },
        { account: bank, credit: 0 },
      ],
      /línea 1 debe ir al debe o al haber/,
    ],
    [
      'línea a cero',
      [{ account: fees, debit: 250 }, { account: bank }],
      /línea 2 debe ir al debe o al haber/,
    ],
    [
      'importe negativo',
      [
        { account: fees, debit: -250 },
        { account: bank, credit: -250 },
      ],
      /negativo/,
    ],
    [
      'fracción de céntimo',
      [
        { account: fees, debit: 2.5 },
        { account: bank, credit: 2.5 },
      ],
      /fracción de céntimo/,
    ],
  ])('rechaza un asiento %s', (_label, lines, message) => {
    expect(() => validateDraft(draft(lines as EntryDraft['lines']))).toThrow(
      UnprocessableEntityException,
    );
    expect(() => validateDraft(draft(lines as EntryDraft['lines']))).toThrow(
      message,
    );
  });

  it('rechaza un asiento sin concepto o con fecha inválida', () => {
    const lines = [
      { account: fees, debit: 1 },
      { account: bank, credit: 1 },
    ];
    expect(() => validateDraft(draft(lines, { concept: '  ' }))).toThrow(
      /concepto/,
    );
    expect(() =>
      validateDraft(draft(lines, { date: new Date('no es fecha') })),
    ).toThrow(/fecha/);
  });
});

describe('accountingDay', () => {
  it('se queda con el día UTC y descarta la hora', () => {
    expect(accountingDay(new Date('2026-12-31T23:59:59Z')).toISOString()).toBe(
      '2026-12-31T00:00:00.000Z',
    );
  });
});
