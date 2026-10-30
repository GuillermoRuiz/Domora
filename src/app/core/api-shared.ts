import { EstateType, PayMethod } from './models';

/**
 * Helpers de mapeo usados por MÁS DE UN dominio (por eso viven acá y no
 * dentro de un `<dominio>.service.ts`). Los enums de la API llegan con los
 * identificadores Prisma SIN acentos ('Domiciliacion', 'Urbanizacion'…) y
 * se traducen a los strings de display con acentos que esperan los
 * componentes ('Domiciliación', 'Urbanización'…). Los mapeos que solo usa
 * un dominio (issues, remesas, gestión de deuda, admin status)
 * viven dentro de su propio servicio, no acá.
 */

/** Normaliza una fecha ISO ('2026-05-02T00:00:00.000Z') a 'YYYY-MM-DD'. */
export function d(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : '';
}

// ── Estate type: Estates + Accounting estates + Adhesion requests ─────────
export const ESTATE_TYPE_FROM_API: Record<string, EstateType> = {
  Edificio: 'Edificio', Urbanizacion: 'Urbanización', Garaje: 'Garaje', Trasteros: 'Trasteros', Local: 'Local',
};
export const ESTATE_TYPE_TO_API: Record<string, string> = {
  'Edificio': 'Edificio', 'Urbanización': 'Urbanizacion', 'Garaje': 'Garaje', 'Trasteros': 'Trasteros', 'Local': 'Local',
};

// ── Payment method: Admins (billing) + Receipts ────────────────────────────
export const PAY_METHOD_FROM_API: Record<string, PayMethod> = {
  Domiciliacion: 'Domiciliación', Transferencia: 'Transferencia', Efectivo: 'Efectivo',
  PagoEnOficina: 'Pago en oficina', Bizum: 'Bizum', Devolucion: 'Devolución', Pendiente: 'Pendiente',
};
export const PAY_METHOD_TO_API: Record<string, string> = {
  'Domiciliación': 'Domiciliacion', 'Transferencia': 'Transferencia', 'Efectivo': 'Efectivo',
  'Pago en oficina': 'PagoEnOficina', 'Bizum': 'Bizum', 'Devolución': 'Devolucion', 'Pendiente': 'Pendiente',
};
