import type { MilestoneKind, PendingKind } from '../../core/manager-overview.models';

/** Destino de una fila de «Pendientes de hoy» o «Próximos hitos»: la pantalla que permite gestionarla. */
export interface OverviewRoute {
  commands: string[];
  queryParams?: Record<string, string>;
}

/**
 * Cada tipo de elemento lleva a la gestión que ya existe: cuotas a la contabilidad de la finca y el
 * resto a la pestaña correspondiente de su ficha. No se crea ninguna pantalla ni comportamiento nuevo.
 */
export function overviewRoute(kind: PendingKind | MilestoneKind, estateId: string): OverviewRoute {
  switch (kind) {
    case 'receipt':
      return { commands: ['/b/accounting', estateId] };
    case 'installation':
      return { commands: ['/b/estates', estateId], queryParams: { tab: 'amenities' } };
    case 'inspection':
      return { commands: ['/b/estates', estateId], queryParams: { tab: 'inspections' } };
    case 'contract':
      return { commands: ['/b/estates', estateId], queryParams: { tab: 'contracts' } };
    case 'adhesion':
      return { commands: ['/b/estates', estateId], queryParams: { tab: 'requests' } };
    case 'meeting':
      return { commands: ['/b/estates', estateId], queryParams: { tab: 'juntas' } };
  }
}
