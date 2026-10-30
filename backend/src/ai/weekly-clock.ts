export const WEEKLY_CRON = '0 0 0 * * 6';
export const WEEKLY_TIME_ZONE = 'Europe/Madrid';
export function madridDate(now: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: WEEKLY_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const v = (type: string) => p.find((x) => x.type === type)!.value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}
/** Calendar arithmetic after IANA-zone conversion; no UTC offset assumption. */
export function madridWeekKey(now: Date): string {
  const day = new Date(`${madridDate(now)}T00:00:00Z`);
  const distance = (day.getUTCDay() + 1) % 7;
  day.setUTCDate(day.getUTCDate() - distance);
  return day.toISOString().slice(0, 10);
}
