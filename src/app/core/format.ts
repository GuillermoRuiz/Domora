/** Coeficiente de participación: "2,50 %" (o "—" si no está informado). */
export function formatQuota(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`;
}
