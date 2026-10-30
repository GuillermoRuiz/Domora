/**
 * Categorías del reparto de gastos del Resumen. Agrupan las cuentas de gasto
 * (grupo 6) del plan por lo que significan para una comunidad; la clave es
 * estable porque el frontend le asigna un color fijo a cada una.
 */
export type ExpenseCategoryKey =
  | 'maintenance'
  | 'supplies'
  | 'staff'
  | 'insurance'
  | 'services'
  | 'other';

export const EXPENSE_CATEGORIES: { key: ExpenseCategoryKey; label: string }[] = [
  { key: 'maintenance', label: 'Mantenimiento' },
  { key: 'supplies', label: 'Suministros' },
  { key: 'staff', label: 'Personal' },
  { key: 'insurance', label: 'Seguros' },
  { key: 'services', label: 'Servicios y profesionales' },
  { key: 'other', label: 'Otros' },
];

/** Categoría de una cuenta de gasto por su código; lo no reconocido (incluidas cuentas propias de la finca) cae en "Otros". */
export function expenseCategoryFor(accountCode: string): ExpenseCategoryKey {
  if (accountCode === '622') return 'maintenance';
  if (accountCode === '628') return 'supplies';
  if (accountCode.startsWith('64')) return 'staff'; // sueldos (640), Seguridad Social (642)…
  if (accountCode === '625') return 'insurance';
  if (accountCode === '623' || accountCode === '629') return 'services';
  return 'other';
}
