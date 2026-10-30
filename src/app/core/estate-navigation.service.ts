import { Injectable, signal, type Signal } from '@angular/core';
import type { Estate } from './models';

/** Secciones que se muestran como pestañas de la ficha de finca. */
export type VisibleEstateTab = 'summary' | 'properties' | 'amenities' | 'providers' | 'contracts' | 'documents' | 'general';

/**
 * Secciones que ya no se pintan en la barra de pestañas pero siguen
 * funcionando por deep link (`?tab=<id>`) y desde los enlaces del Resumen.
 * Ver "Tabs desplazadas" en `odd/tasks/finca-dashboard-b.md`.
 */
export type LegacyEstateTab = 'requests' | 'issues' | 'sepa' | 'juntas' | 'communications' | 'inspections';

export type EstateTab = VisibleEstateTab | LegacyEstateTab;

export const ESTATE_TABS: { id: VisibleEstateTab; label: string }[] = [
  { id: 'summary', label: 'Resumen' },
  { id: 'properties', label: 'Propiedades' },
  { id: 'amenities', label: 'Instalaciones' },
  { id: 'providers', label: 'Proveedores' },
  { id: 'contracts', label: 'Contratos' },
  { id: 'documents', label: 'Documentos' },
  { id: 'general', label: 'Datos generales' },
];

/**
 * Agrupación anterior (11 pestañas en 3 grupos). Se conserva SOLO como
 * referencia para recuperar una sección: añadir su id a `ESTATE_TABS` basta
 * para volver a mostrarla, porque su contenido sigue montado en
 * `estate-detail.component.html`.
 */
export const LEGACY_ESTATE_NAV_GROUPS: { id: string; label: string; items: { id: EstateTab; label: string }[] }[] = [
  { id: 'administration', label: 'Administración de la finca', items: [
    { id: 'properties', label: 'Propiedades' },
    { id: 'requests', label: 'Solicitudes de adhesión' },
    { id: 'sepa', label: 'Facturación SEPA' },
  ] },
  { id: 'community', label: 'Comunidad y comunicación', items: [
    { id: 'documents', label: 'Documentos' },
    { id: 'juntas', label: 'Juntas' },
    { id: 'communications', label: 'Comunicados' },
  ] },
  { id: 'maintenance', label: 'Mantenimiento y servicios', items: [
    { id: 'issues', label: 'Incidencias' },
    { id: 'amenities', label: 'Instalaciones' },
    { id: 'inspections', label: 'Inspecciones' },
    { id: 'providers', label: 'Proveedores y Personal' },
  ] },
];

const ALL_TAB_LABELS: Record<string, string> = Object.fromEntries([
  ...LEGACY_ESTATE_NAV_GROUPS.flatMap(group => group.items.map(item => [item.id, item.label])),
  ...ESTATE_TABS.map(tab => [tab.id, tab.label]),
]);

export const ALL_ESTATE_TAB_IDS: EstateTab[] = Object.keys(ALL_TAB_LABELS) as EstateTab[];

export function estateTabLabel(tab: EstateTab): string {
  return ALL_TAB_LABELS[tab];
}

export function isLegacyEstateTab(tab: EstateTab): tab is LegacyEstateTab {
  return !ESTATE_TABS.some(visible => visible.id === tab);
}

export interface EstateNavigationContext {
  estate: Signal<Estate | null>;
  activeTab: Signal<EstateTab>;
  selectTab: (tab: EstateTab) => void;
}

/** Comparte con el resto de la app la finca abierta y su pestaña activa. */
@Injectable({ providedIn: 'root' })
export class EstateNavigationService {
  readonly context = signal<EstateNavigationContext | null>(null);
  readonly tabs = ESTATE_TABS;
}
