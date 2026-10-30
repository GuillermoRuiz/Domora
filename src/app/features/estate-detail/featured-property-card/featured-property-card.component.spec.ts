import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import { FeaturedPropertyCardComponent, type FeaturedProperty } from './featured-property-card.component';

const property = (overrides: Partial<FeaturedProperty> = {}): FeaturedProperty => ({
  id: 'p1', ref: '3ºA', subtitle: 'Vivienda · 3ª planta', titular: 'Ruiz Martín, Jorge', quotaMonthly: 120,
  balance: 1200, status: { text: 'En mora', tone: 'warning' }, lastPaymentDate: '2024-12-12', ownerSince: '2019-03-14',
  ...overrides,
});

describe('FeaturedPropertyCardComponent', () => {
  let h: ComponentHarness<FeaturedPropertyCardComponent>;

  function mount(p: FeaturedProperty | null, facade: string | null = 'https://catastro.test/f.jpg'): void {
    h = setupComponent(FeaturedPropertyCardComponent);
    h.fixture.componentRef.setInput('property', p);
    h.fixture.componentRef.setInput('facadeUrl', facade);
    h.fixture.componentRef.setInput('estateName', 'Residencial Plaza');
    h.fixture.detectChanges();
  }
  const detail = (id: string) => h.el.querySelector(`[data-detail="${id}"] dd`)?.textContent?.replace(/\s+/g, ' ').trim();

  it('muestra referencia, estado, subtítulo y los cinco datos de la propiedad', () => {
    mount(property());
    expect(h.el.querySelector('.featured__ref')?.textContent?.trim()).toBe('3ºA');
    expect(h.el.querySelector('.pill--warning')?.textContent).toContain('En mora');
    expect(h.el.querySelector('.featured__subtitle')?.textContent).toContain('Vivienda · 3ª planta');
    expect(detail('titular')).toBe('Ruiz Martín, Jorge');
    expect(detail('quota')).toMatch(/^120,00\s?€$/);
    expect(detail('balance')).toMatch(/^1\.200,00\s?€$/);
    expect(h.el.querySelector('[data-detail="balance"] dd')?.classList).toContain('featured__owes');
    expect(detail('lastPayment')).toMatch(/^12 dic 2024$/);
    expect(detail('ownerSince')).toMatch(/^14 mar 2019$/);
  });

  it('lo que no se sabe se muestra con guion y el saldo solo es rojo si debe', () => {
    mount(property({ titular: null, quotaMonthly: null, balance: 0, lastPaymentDate: null, ownerSince: null, status: null }));
    expect(detail('titular')).toBe('—');
    expect(detail('quota')).toBe('—');
    expect(detail('lastPayment')).toBe('—');
    expect(detail('ownerSince')).toBe('—');
    expect(h.el.querySelector('[data-detail="balance"] dd')?.classList).not.toContain('featured__owes');
    expect(h.el.querySelector('.featured__head app-status-pill')).toBeNull();
  });

  it('sin saldo cargado (null) muestra guion, no 0', () => {
    mount(property({ balance: null }));
    expect(detail('balance')).toBe('—');
  });

  it('usa la fachada de la finca como foto', () => {
    mount(property());
    expect(h.el.querySelector('.featured__photo img')?.getAttribute('src')).toBe('https://catastro.test/f.jpg');
  });

  it('sin foto muestra el marcador de posición de la fachada', () => {
    mount(property(), null);
    expect(h.el.querySelector('.featured__photo img')).toBeNull();
    expect(h.el.querySelector('.facade-fallback')).not.toBeNull();
  });

  it('"Ver propiedad" emite su id', () => {
    mount(property());
    const opened: string[] = [];
    h.component.view.subscribe((id) => opened.push(id));
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(opened).toEqual(['p1']);
  });

  it('sin propiedad invita a seleccionar una y no ofrece "Ver propiedad"', () => {
    mount(null);
    expect(h.el.textContent).toContain('Selecciona una propiedad');
    expect(h.el.querySelector('.section-card__action')).toBeNull();
  });
});
