import { setupComponent, type ComponentHarness } from '../../../../core/testing/component-harness';
import type { SupplierIntervention } from '../../../../core/supplier-panel.models';
import { SupplierInterventionsComponent } from './supplier-interventions.component';

const intervention = (overrides: Partial<SupplierIntervention> = {}): SupplierIntervention => ({
  id: 'v1', supplierId: 's1', supplierName: 'Ascensores Levante', supplierCategory: 'Ascensores', purpose: 'Revisión mensual del ascensor',
  scheduledAt: '2026-10-05T10:00:00.000Z', completedAt: '2026-10-05T12:00:00.000Z', notes: null, asset: null, issue: null, ...overrides,
});

describe('SupplierInterventionsComponent', () => {
  let h: ComponentHarness<SupplierInterventionsComponent>;

  function mount(items: SupplierIntervention[]): void {
    h = setupComponent(SupplierInterventionsComponent);
    h.fixture.componentRef.setInput('interventions', items);
    h.fixture.detectChanges();
  }
  const rows = () => Array.from(h.el.querySelectorAll('[data-intervention]'));

  it('lista cada intervención con su motivo, proveedor y fecha, en el orden recibido', () => {
    mount([
      intervention({ id: 'v1', purpose: 'Revisión mensual del ascensor' }),
      intervention({ id: 'v2', purpose: 'Poda y mantenimiento de jardín', supplierName: 'Jardinería Mediterráneo', completedAt: '2026-09-20T12:00:00.000Z' }),
    ]);
    expect(rows().map(r => r.querySelector('.intervention__purpose')?.textContent?.trim())).toEqual(['Revisión mensual del ascensor', 'Poda y mantenimiento de jardín']);
    expect(rows()[0].querySelector('.intervention__sub')?.textContent?.trim()).toBe('Ascensores Levante');
    expect(rows()[0].querySelector('.intervention__date')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('05oct');
    expect(rows()[1].querySelector('.intervention__date')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('20sept');
  });

  it('indica la instalación y la incidencia a las que se refería, si las hubo', () => {
    mount([intervention({ asset: { id: 'a1', name: 'Ascensor A' }, issue: { id: 'i1', ref: '#INC-2026-01', title: 'Ruido' } })]);
    expect(rows()[0].textContent).toContain('Instalación: Ascensor A · Incidencia #INC-2026-01');
  });

  it('sin instalación ni incidencia no añade esa línea', () => {
    mount([intervention()]);
    expect(rows()[0].textContent).not.toContain('Instalación');
    expect(rows()[0].querySelectorAll('.intervention__sub')).toHaveLength(1);
  });

  it('pulsar una intervención avisa del proveedor al que pertenece', () => {
    mount([intervention({ id: 'v7', supplierId: 's9' })]);
    const opened: string[] = [];
    h.component.openSupplier.subscribe(id => opened.push(id));
    (rows()[0] as HTMLElement).click();
    expect(opened).toEqual(['s9']);
  });

  it('sin intervenciones explica cuándo aparecerán', () => {
    mount([]);
    expect(rows()).toEqual([]);
    expect(h.el.textContent).toContain('Todavía no hay visitas realizadas');
  });
});
