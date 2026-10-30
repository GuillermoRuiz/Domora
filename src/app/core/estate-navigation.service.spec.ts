import { TestBed } from '@angular/core/testing';
import {
  ALL_ESTATE_TAB_IDS, ESTATE_TABS, EstateNavigationService, LEGACY_ESTATE_NAV_GROUPS,
  estateTabLabel, isLegacyEstateTab,
} from './estate-navigation.service';

describe('EstateNavigationService', () => {
  it('shows exactly the seven tabs, in order', () => {
    const nav = TestBed.inject(EstateNavigationService);
    expect(nav.tabs.map(tab => tab.id)).toEqual(['summary', 'properties', 'amenities', 'providers', 'contracts', 'documents', 'general']);
    expect(nav.tabs.map(tab => tab.label)).toEqual(['Resumen', 'Propiedades', 'Instalaciones', 'Proveedores', 'Contratos', 'Documentos', 'Datos generales']);
    // Meetings and issues live in their global workspaces, not in the finca tab bar.
    expect(nav.tabs.map(tab => tab.id)).not.toContain('issues');
    expect(nav.tabs.map(tab => tab.id)).not.toContain('juntas');
  });

  it('keeps every legacy section reachable: ids and labels survive the redesign', () => {
    const legacy = LEGACY_ESTATE_NAV_GROUPS.flatMap(group => group.items.map(item => item.id));
    expect(new Set(legacy).size).toBe(legacy.length);
    for (const id of legacy) {
      expect(ALL_ESTATE_TAB_IDS).toContain(id);
      expect(estateTabLabel(id)).toBeTruthy();
    }
    expect(ALL_ESTATE_TAB_IDS).toHaveLength(13);
  });

  it('tells hidden sections from visible ones', () => {
    for (const tab of ESTATE_TABS) expect(isLegacyEstateTab(tab.id)).toBe(false);
    for (const id of ['requests', 'issues', 'sepa', 'juntas', 'communications', 'inspections'] as const) {
      expect(isLegacyEstateTab(id)).toBe(true);
    }
  });

  it('prefers the new label when an id exists in both models', () => {
    expect(estateTabLabel('providers')).toBe('Proveedores');
    expect(estateTabLabel('issues')).toBe('Incidencias');
  });
});
