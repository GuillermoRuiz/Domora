import { currentOffices, localDay, sameHolder, type EstateOfficeTerm } from './estate-governance.service';

const term = (over: Partial<EstateOfficeTerm>): EstateOfficeTerm => ({
  id: 't', estateId: 'e', role: 'PRESIDENT', propertyId: null, userId: null, externalOwnerId: null,
  holderNameSnapshot: 'Titular', startsAt: '2026-01-01', endsAt: null, ...over,
});

describe('currentOffices', () => {
  it('returns the president and vice-presidents in force, ranked by appointment order', () => {
    const offices = currentOffices([
      term({ id: 'old', role: 'PRESIDENT', startsAt: '2024-01-01', endsAt: '2026-01-01' }),
      term({ id: 'p', role: 'PRESIDENT', startsAt: '2026-01-01' }),
      term({ id: 'v2', role: 'VICE_PRESIDENT', startsAt: '2026-03-01' }),
      term({ id: 'v1', role: 'VICE_PRESIDENT', startsAt: '2026-02-01T00:00:00.000Z' }),
    ], '2026-06-01');
    expect(offices.president).toEqual({ term: expect.objectContaining({ id: 'p' }), label: 'Presidente' });
    expect(offices.vicePresidents.map(o => [o.term.id, o.label])).toEqual([['v1', 'Vicepresidente 1º'], ['v2', 'Vicepresidente 2º']]);
  });

  it('moves the next vice-president up when one has left, and excludes terms ending today or starting later', () => {
    const offices = currentOffices([
      term({ id: 'gone', role: 'VICE_PRESIDENT', startsAt: '2025-01-01', endsAt: '2026-06-01' }),
      term({ id: 'stays', role: 'VICE_PRESIDENT', startsAt: '2025-06-01' }),
      term({ id: 'future', role: 'PRESIDENT', startsAt: '2026-07-01' }),
    ], '2026-06-01');
    expect(offices.president).toBeNull();
    expect(offices.vicePresidents.map(o => [o.term.id, o.label])).toEqual([['stays', 'Vicepresidente 1º']]);
  });

  it('matches holders by user or external owner id, never by name', () => {
    expect(sameHolder(term({ userId: 'u1' }), { userId: 'u1', externalOwnerId: null, name: 'Otro' })).toBe(true);
    expect(sameHolder(term({ externalOwnerId: 'x1' }), { userId: null, externalOwnerId: 'x1', name: 'A' })).toBe(true);
    expect(sameHolder(term({ holderNameSnapshot: 'A' }), { userId: null, externalOwnerId: null, name: 'A' })).toBe(false);
  });

  it('localDay uses the local calendar day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
