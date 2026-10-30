import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { CommunitySummary } from '../../../core/owner-community.models';
import { CommunitySummaryComponent } from './community-summary.component';

const summary = (overrides: Partial<CommunitySummary> = {}, indicators: Partial<CommunitySummary['indicators']> = {}): CommunitySummary => ({
  id: 'e1', name: 'Residencial Plaza', type: 'Edificio', address: 'Calle Gran Vía, 12', postalCode: '28013', location: 'Madrid', province: 'Madrid',
  description: 'Comunidad tranquila y bien mantenida.', photoUpdatedAt: null, catastroFacadeUrl: null,
  indicators: { owners: 24, activeIssues: 1, commonAreas: 'buen_estado', ...indicators }, ...overrides,
});

describe('CommunitySummaryComponent', () => {
  let h: ComponentHarness<CommunitySummaryComponent>;

  function mount(inputs: { summary?: CommunitySummary | null; failed?: boolean; unlinked?: boolean }): void {
    h = setupComponent(CommunitySummaryComponent);
    h.fixture.componentRef.setInput('summary', inputs.summary ?? null);
    h.fixture.componentRef.setInput('failed', inputs.failed ?? false);
    h.fixture.componentRef.setInput('unlinked', inputs.unlinked ?? false);
    h.fixture.detectChanges();
  }
  const indicator = (id: string) => h.el.querySelector(`[data-indicator="${id}"]`) as HTMLElement;
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('muestra el nombre, la dirección y la descripción de la finca', () => {
    mount({ summary: summary() });
    expect(h.el.querySelector('.sum__name')?.textContent?.trim()).toBe('Residencial Plaza');
    expect(text(h.el.querySelector('.sum__address'))).toBe('Calle Gran Vía, 12, Madrid');
    expect(h.el.querySelector('.sum__description')?.textContent?.trim()).toBe('Comunidad tranquila y bien mantenida.');
  });

  it('sin descripción no deja un hueco vacío', () => {
    mount({ summary: summary({ description: null }) });
    expect(h.el.querySelector('.sum__description')).toBeNull();
  });

  it('muestra los tres indicadores', () => {
    mount({ summary: summary() });
    expect(text(indicator('areas'))).toMatch(/Zonas comunes\s?En buen estado/);
    expect(text(indicator('issues'))).toMatch(/Incidencias activas\s?1\s?de la comunidad/);
    expect(text(indicator('owners'))).toMatch(/Propietarios\s?24\s?en la comunidad/);
  });

  it.each([
    ['buen_estado', 'En buen estado', 'indicator--positive'],
    ['en_mantenimiento', 'En mantenimiento', 'indicator--warning'],
    ['requiere_atencion', 'Requiere atención', 'indicator--danger'],
    ['sin_datos', 'Sin información', 'indicator--neutral'],
  ] as const)('las zonas comunes «%s» salen como «%s» con su tono', (state, label, cls) => {
    mount({ summary: summary({}, { commonAreas: state }) });
    expect(text(indicator('areas'))).toContain(label);
    expect(indicator('areas').classList).toContain(cls);
  });

  it('las incidencias activas no se marcan en rojo si no hay ninguna', () => {
    mount({ summary: summary({}, { activeIssues: 0 }) });
    expect(indicator('issues').classList).not.toContain('indicator--danger');
  });

  it('las incidencias activas se marcan en rojo si hay alguna', () => {
    mount({ summary: summary({}, { activeIssues: 3 }) });
    expect(indicator('issues').classList).toContain('indicator--danger');
  });

  it('sin resumen no hay enlace «Ver detalles»', () => {
    mount({ summary: null });
    expect(h.el.querySelector('.section-card__action')).toBeNull();
  });

  it('«Ver detalles» avisa al pulsarlo', () => {
    mount({ summary: summary() });
    let opened = 0;
    h.component.details.subscribe(() => opened++);
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });

  it('mientras llega el resumen dice que carga', () => {
    mount({});
    expect(h.el.textContent).toContain('Cargando…');
  });

  it('si falla el resumen lo avisa', () => {
    mount({ failed: true });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar el resumen de la comunidad');
  });

  it('una propiedad sin finca ofrece solicitar la vinculación en vez del resumen', () => {
    mount({ unlinked: true });
    expect(h.el.querySelector('[data-unlinked]')?.textContent).toContain('aún no está vinculada a una comunidad');
    expect(h.el.querySelector('[data-summary]')).toBeNull();
    let requested = 0;
    h.component.requestLink.subscribe(() => requested++);
    (h.el.querySelector('[data-action="request-link"]') as HTMLButtonElement).click();
    expect(requested).toBe(1);
  });

  it('no enseña nunca nada que no sean los datos de presentación y los tres indicadores', () => {
    mount({ summary: summary() });
    const content = h.el.textContent ?? '';
    for (const forbidden of ['CIF', 'IBAN', 'Propietario A', '@']) expect(content).not.toContain(forbidden);
  });
});
