import { contractStatus, annualizedContractCost } from './contract-rules';

describe('contract semantics', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  it('never considers a future contract active', () => {
    expect(
      contractStatus(
        { startDate: new Date('2026-11-01'), endDate: null, cancelledAt: null },
        now,
      ),
    ).toBe('Programado');
  });
  it('includes the entire end business day', () => {
    expect(
      contractStatus(
        {
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-10-15'),
          cancelledAt: null,
        },
        now,
      ),
    ).toBe('PorVencer');
  });
  it.each([
    ['MONTHLY', '1200'],
    ['QUARTERLY', '400'],
    ['SEMIANNUAL', '200'],
    ['ANNUAL', '100'],
  ] as const)('annualizes only recurring %s costs', (frequency, expected) => {
    expect(annualizedContractCost('100.00', frequency)?.toString()).toBe(
      expected,
    );
  });
  it.each(['OTHER', 'ONE_OFF', null])(
    'does not invent an annualized %s cost',
    (frequency) => {
      expect(annualizedContractCost('100', frequency)).toBeNull();
    },
  );
});
