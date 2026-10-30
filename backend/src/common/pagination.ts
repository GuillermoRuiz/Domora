/**
 * Paginación compartida. Antes cada endpoint que paginaba repetía a mano el
 * mismo `Math.min(200, Math.max(1, ...))`, y los que no paginaban —86 de 94
 * `findMany`— devolvían la tabla entera: un problema de rendimiento (memoria
 * del proceso, latencia, ancho de banda) y también de seguridad, porque una
 * sola petición autorizada extrae el conjunto completo.
 *
 * El tope se aplica SIEMPRE en el servidor: que el cliente pida `pageSize`
 * no significa que se le conceda.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageParams {
  page?: number;
  pageSize?: number;
}

/** Envoltorio de respuesta paginada — mismo shape que ya usaban recibos y movimientos. */
export interface Page<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}

export interface ResolvedPage {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Normaliza y acota los parámetros; tolera NaN, negativos y decimales. */
export function resolvePage(params: PageParams = {}): ResolvedPage {
  const rawPage = Math.trunc(Number(params.page));
  const rawSize = Math.trunc(Number(params.pageSize));

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize > 0
      ? Math.min(rawSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** Construye la respuesta paginada a partir del total y los elementos. */
export function toPage<T>(
  total: number,
  resolved: ResolvedPage,
  items: T[],
): Page<T> {
  return {
    total,
    page: resolved.page,
    pageSize: resolved.pageSize,
    items,
  };
}
