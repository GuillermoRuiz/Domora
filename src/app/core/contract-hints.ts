/**
 * Cadencia de revisión SUGERIDA por categoría — nunca forzada, solo
 * precarga el campo al elegir la categoría. Ascensores y extintores/PCI
 * tienen periodicidad legal propia en España (mantenimiento de ascensores
 * por empresa instaladora autorizada; RIPCI —RD 513/2017— para extintores,
 * revisión trimestral + anual + retimbrado cada 5 años).
 */
export function suggestedReviewFrequency(serviceType: string): string {
  const key = serviceType.trim().toLowerCase();
  if (key.includes('ascensor')) return 'Cuatrimestral (normativa de mantenimiento de ascensores)';
  if (key.includes('extintor') || key.includes('pci') || key.includes('incendio')) {
    return 'Trimestral + anual (RIPCI) — retimbrado cada 5 años';
  }
  return '';
}
