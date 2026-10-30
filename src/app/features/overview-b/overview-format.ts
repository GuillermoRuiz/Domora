import type { KpiChange } from '../../core/manager-overview.models';

/** Euros con formato español; sin decimales por defecto (cifras de resumen). */
export function formatEuro(value: number, decimals = 0): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** «nuevo», «+12,5 %», «−33,3 %» o «0 %». */
export function formatChange(change: KpiChange): string {
  if (change.type === 'new') return 'nuevo';
  if (change.value === 0) return '0 %';
  const abs = Math.abs(change.value).toLocaleString('es-ES', { maximumFractionDigits: 1 });
  return `${change.value > 0 ? '+' : '−'}${abs} %`;
}

export type ChangeTone = 'positive' | 'danger' | 'neutral';

/**
 * Color de la variación. Bajar incidencias, solicitudes sin responder y cuotas pendientes es bueno
 * (`goodWhen: 'down'`); en el resto lo bueno es subir (D9). Sin cambio, neutro.
 */
export function changeTone(change: KpiChange, goodWhen: 'up' | 'down'): ChangeTone {
  if (change.type === 'percent' && change.value === 0) return 'neutral';
  const up = change.type === 'new' || change.value > 0;
  return up === (goodWhen === 'up') ? 'positive' : 'danger';
}
