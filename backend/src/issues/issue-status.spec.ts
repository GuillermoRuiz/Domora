import { issueStatusDates } from './issue-status';

describe('structured issue lifecycle', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  it.each(['Abierta', 'PendienteProveedor'] as const)(
    'records resolution from %s',
    (from) => {
      expect(issueStatusDates(from, 'Resuelta', now)).toEqual({
        resolvedAt: now,
        closedAt: null,
      });
    },
  );
  it('records direct closure without inventing a resolution', () => {
    expect(issueStatusDates('Abierta', 'Cerrada', now)).toEqual({
      closedAt: now,
    });
  });
  it('clears current cycle markers on reopening, then records a new resolution', () => {
    expect(issueStatusDates('Resuelta', 'Abierta', now)).toEqual({
      resolvedAt: null,
      closedAt: null,
    });
    const second = new Date('2026-10-16T12:00:00Z');
    expect(issueStatusDates('Abierta', 'Resuelta', second).resolvedAt).toEqual(
      second,
    );
  });
  it('does not reset timestamps when the state is unchanged', () => {
    expect(issueStatusDates('Resuelta', 'Resuelta', now)).toEqual({});
  });
});
