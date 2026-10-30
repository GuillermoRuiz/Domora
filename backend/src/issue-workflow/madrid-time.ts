const MADRID = 'Europe/Madrid';

/** Diferencia (ms) entre la hora de pared de Madrid y UTC en un instante dado. */
function madridOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MADRID,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/**
 * Instante UTC de una fecha y hora de pared de Madrid (`2026-10-06`, `09:30`).
 * Las respuestas de los proveedores hablan en hora local; la base de datos, en UTC.
 */
export function madridLocalToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const asIfUtc = Date.UTC(y, m - 1, d, hh, mm);
  let instant = asIfUtc - madridOffsetMs(new Date(asIfUtc));
  // Cerca de un cambio de hora, el desfase correcto es el del propio instante resultante.
  const corrected = asIfUtc - madridOffsetMs(new Date(instant));
  if (corrected !== instant) instant = corrected;
  return new Date(instant);
}
