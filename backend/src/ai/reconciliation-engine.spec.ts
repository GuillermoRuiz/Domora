import { reconcile, normalizeName } from './reconciliation-engine';
const bank = (
  id: string,
  cents = -120000,
  concept = 'FAC F-100 ASCENSORES CENTRO',
  date = '2026-10-02',
) => ({
  id,
  estateId: 'e1',
  bankAccountId: 'b1',
  cents,
  concept,
  reference: 'F-100',
  date,
});
const line = (id: string, cents = -120000, date = '2026-10-01') => ({
  id,
  estateId: 'e1',
  bankAccountId: 'b1',
  cents,
  concept: 'F-100',
  reference: 'F-100',
  date,
  supplierName: 'Ascensores Centro SL',
  invoiceIds: ['i1'],
});
describe('explainable exact-cent reconciliation', () => {
  it('automatically matches unique amount plus exact reference', () =>
    expect(reconcile([bank('b')], [line('l')])[0].tier).toBe('high'));
  it('allows a bank posting date offset', () =>
    expect(
      reconcile([bank('b')], [line('l', -120000, '2026-09-24')])[0].tier,
    ).toBe('high'));
  it('normalizes supplier trading names', () =>
    expect(normalizeName('ÁSCENSORES DEL CENTRO, S.L.')).toBe(
      normalizeName('Ascensores del Centro SL'),
    ));
  it('does not automatically choose between ambiguous same references', () =>
    expect(
      reconcile([bank('b')], [line('l1'), line('l2')]).every(
        (x) => x.tier === 'medium',
      ),
    ).toBe(true));
  it('leaves unrelated amounts unmatched', () =>
    expect(reconcile([bank('b', -100)], [line('l')])).toEqual([]));
  it('supports a split payment without inventing cents', () => {
    const r = reconcile([bank('b1', -60000), bank('b2', -60000)], [line('l')]);
    expect(r.find((x) => x.entryIds.length === 2)?.tier).toBe('medium');
  });
  it('supports one payment to several posted lines', () =>
    expect(
      reconcile([bank('b')], [line('l1', -60000), line('l2', -60000)]).some(
        (x) => x.lineIds.length === 2,
      ),
    ).toBe(true));
  it('does not silently collapse repeated bank rows', () =>
    expect(
      reconcile([bank('b1'), bank('b2')], [line('l')]).every(
        (x) => x.tier === 'medium',
      ),
    ).toBe(true));
  it('throws on repeated IDs', () =>
    expect(() => reconcile([bank('b'), bank('b')], [line('l')])).toThrow());
  it('rejects cross-community input', () =>
    expect(() =>
      reconcile([bank('b')], [{ ...line('l'), estateId: 'e2' }]),
    ).toThrow());
  it('does not reconcile opposite signed amounts', () =>
    expect(reconcile([bank('b', 120000)], [line('l')])).toEqual([]));
  it('handles a posted refund on both sides', () =>
    expect(reconcile([bank('b', 120000)], [line('l', 120000)])[0].tier).toBe(
      'high',
    ));
  it('does not auto-match amount and date alone', () => {
    const r = reconcile(
      [{ ...bank('b'), concept: 'TRANSFERENCIA', reference: null }],
      [{ ...line('l'), concept: 'PAGO', reference: null }],
    );
    expect(r[0].tier).toBe('medium');
  });
});
