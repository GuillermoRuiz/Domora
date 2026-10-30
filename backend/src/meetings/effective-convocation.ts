/**
 * Una junta convocada tiene dos convocatorias. Sigue vigente hasta que pasa la segunda; su fecha
 * efectiva es la primera si aún no ha pasado y, si no, la segunda. `null` = ya no hay convocatoria.
 * Lo usan el panel del gestor y el del propietario para que ambos muestren la misma "próxima junta".
 */
export function effectiveConvocation(
  meeting: { scheduledAt1: Date; scheduledAt2: Date },
  now: Date,
): Date | null {
  if (meeting.scheduledAt1 >= now) return meeting.scheduledAt1;
  return meeting.scheduledAt2 >= now ? meeting.scheduledAt2 : null;
}
