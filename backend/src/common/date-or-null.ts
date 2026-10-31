/** Fecha opcional de un PATCH: `null` borra el valor (`new Date(null)` sería 1970-01-01). */
export const dateOrNull = (value: string | null): Date | null =>
  value === null ? null : new Date(value);
