import { madridWeekKey, WEEKLY_CRON, WEEKLY_TIME_ZONE } from './weekly-clock';
describe('Madrid schedule and durable weekly key', () => {
  it('uses a timezone-aware Saturday midnight cron', () => {
    expect(WEEKLY_CRON).toBe('0 0 0 * * 6');
    expect(WEEKLY_TIME_ZONE).toBe('Europe/Madrid');
  });
  it('winter midnight is Friday 23 UTC', () =>
    expect(madridWeekKey(new Date('2026-01-02T23:00:00Z'))).toBe('2026-01-03'));
  it('summer midnight is Friday 22 UTC', () =>
    expect(madridWeekKey(new Date('2026-07-03T22:00:00Z'))).toBe('2026-07-04'));
  it('spring DST week remains the previous Saturday', () =>
    expect(madridWeekKey(new Date('2026-03-29T01:00:00Z'))).toBe('2026-03-28'));
  it('autumn DST week is stable across both repeated hours', () =>
    expect(madridWeekKey(new Date('2026-10-25T00:30:00Z'))).toBe(
      madridWeekKey(new Date('2026-10-25T01:30:00Z')),
    ));
  it('Friday before midnight remains last week', () =>
    expect(madridWeekKey(new Date('2026-07-03T21:59:59Z'))).toBe('2026-06-27'));
});
