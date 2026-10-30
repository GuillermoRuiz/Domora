import { setupComponent, type ComponentHarness } from '../../../../core/testing/component-harness';
import type { SupplierPanelRow } from '../../../../core/supplier-panel.models';
import { SupplierQuickContactComponent } from './supplier-quick-contact.component';

const supplier = (overrides: Partial<SupplierPanelRow> = {}): SupplierPanelRow => ({
  id: 's1', name: 'Ascensores Levante', category: 'Ascensores', status: 'Activo', contactName: 'Marta Ruiz Gil', phone: '96 341 09 77',
  email: 'marta@levante.test', displayStatus: 'activo', contract: null, nextVisit: null, openIssues: 0, ...overrides,
});

describe('SupplierQuickContactComponent', () => {
  let h: ComponentHarness<SupplierQuickContactComponent>;

  function mount(s: SupplierPanelRow | null): void {
    h = setupComponent(SupplierQuickContactComponent);
    h.fixture.componentRef.setInput('supplier', s);
    h.fixture.detectChanges();
  }
  const field = (name: string) => h.el.querySelector(`[data-field="${name}"]`)?.textContent?.replace(/\s+/g, ' ').trim();
  const action = (name: string) => h.el.querySelector(`[data-action="${name}"]`) as HTMLAnchorElement | null;

  it('muestra la persona de contacto, su proveedor, teléfono y correo', () => {
    mount(supplier());
    expect(h.el.querySelector('.contact__person')?.textContent?.trim()).toBe('Marta Ruiz Gil');
    expect(h.el.querySelector('.contact__company')?.textContent).toContain('Ascensores Levante');
    expect(h.el.querySelector('.contact__avatar')?.textContent?.trim()).toBe('MR');
    expect(field('phone')).toBe('96 341 09 77');
    expect(field('email')).toBe('marta@levante.test');
  });

  it('«Llamar» marca el teléfono sin espacios y «Escribir» abre el correo', () => {
    mount(supplier({ phone: '+34 96 341 09 77' }));
    expect(action('call')?.getAttribute('href')).toBe('tel:+34963410977');
    expect(action('mail')?.getAttribute('href')).toBe('mailto:marta@levante.test');
  });

  it('sin persona de contacto usa el nombre del proveedor', () => {
    mount(supplier({ contactName: null }));
    expect(h.el.querySelector('.contact__person')?.textContent?.trim()).toBe('Ascensores Levante');
    expect(h.el.querySelector('.contact__avatar')?.textContent?.trim()).toBe('AL');
  });

  it('solo ofrece los atajos de los que hay dato', () => {
    mount(supplier({ email: null }));
    expect(action('call')).not.toBeNull();
    expect(action('mail')).toBeNull();
    expect(field('email')).toBe('—');
  });

  it('sin teléfono ni correo lo dice en vez de dejar botones muertos', () => {
    mount(supplier({ phone: null, email: null }));
    expect(action('call')).toBeNull();
    expect(action('mail')).toBeNull();
    expect(h.el.querySelector('.contact__none')?.textContent).toContain('no tiene teléfono ni correo');
  });

  it('muestra la próxima visita con su motivo, o que no hay ninguna', () => {
    mount(supplier({ nextVisit: { id: 'v1', scheduledAt: '2030-03-01T09:30:00.000Z', purpose: 'Revisión mensual' } }));
    expect(field('visit')).toMatch(/2030/);
    expect(field('visit')).toContain('Revisión mensual');
  });

  it('sin visita programada lo dice', () => {
    mount(supplier());
    expect(field('visit')).toBe('Sin visitas programadas');
  });

  it('sin proveedor seleccionado invita a elegir uno', () => {
    mount(null);
    expect(h.el.querySelector('[data-quick-contact]')).toBeNull();
    expect(h.el.querySelector('.contact__empty')?.textContent).toContain('Selecciona un proveedor');
  });
});
