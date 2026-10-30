import { autoMatch, type MatchItem } from './reconciliation.rules';

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
const it_ = (id: string, date: string, amount: number): MatchItem => ({
  id,
  date: D(date),
  amount,
});

describe('autoMatch', () => {
  it('empareja por importe exacto y la fecha más cercana', () => {
    const pairs = autoMatch(
      [it_('e1', '2026-03-06', -10000), it_('e2', '2026-03-20', 25000)],
      [
        it_('l-lejos', '2026-03-01', -10000),
        it_('l-cerca', '2026-03-05', -10000),
        it_('l2', '2026-03-19', 25000),
      ],
    );
    expect(pairs).toEqual([
      { entryId: 'e1', lineId: 'l-cerca' },
      { entryId: 'e2', lineId: 'l2' },
    ]);
  });

  it('no empareja importes distintos ni fechas demasiado lejanas', () => {
    expect(
      autoMatch(
        [it_('e1', '2026-03-06', -10000)],
        [it_('l1', '2026-03-06', -10001)],
      ),
    ).toEqual([]);
    expect(
      autoMatch(
        [it_('e1', '2026-03-30', -10000)],
        [it_('l1', '2026-03-01', -10000)],
      ),
    ).toEqual([]);
    expect(
      autoMatch(
        [it_('e1', '2026-03-30', -10000)],
        [it_('l1', '2026-03-01', -10000)],
        30,
      ),
    ).toHaveLength(1);
  });

  it('cada partida y cada línea se usan una sola vez', () => {
    const pairs = autoMatch(
      [
        it_('e1', '2026-03-05', 5000),
        it_('e2', '2026-03-06', 5000),
        it_('e3', '2026-03-07', 5000),
      ],
      [it_('l1', '2026-03-05', 5000), it_('l2', '2026-03-07', 5000)],
    );
    expect(pairs).toEqual([
      { entryId: 'e1', lineId: 'l1' },
      { entryId: 'e3', lineId: 'l2' },
    ]);
  });
});
