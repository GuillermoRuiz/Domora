import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateDashboardSummary } from '../../../core/estate-dashboard.models';
import type { EstateTab } from '../../../core/estate-navigation.service';
import type { Estate } from '../../../core/models';
import { SummaryTabComponent } from './summary-tab.component';

function makeEstate(overrides: Partial<Estate> = {}): Estate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Residencial Plaza', type: 'Edificio',
    address: 'Calle Gran Vía', streetNumber: '12', location: 'Madrid',
    properties: 0, residents: 0, requests: 0, activeIssues: 0, occupancy: 0,
    reserveTarget: 0, iban: undefined, color: null,
    ...overrides,
  };
}

const SUMMARY: EstateDashboardSummary = {
  estateId: 'e1', units: 24, balance: 12450,
  pendingDues: { amount: 1250, properties: 2 },
  issues: { open: 2, thisYear: 12 },
  nextMeeting: { id: 'm1', title: 'Junta ordinaria', type: 'ordinaria', scheduledAt: '2026-03-15T18:00:00.000Z' },
};

const EMPTY_CASHFLOW = { year: 2026, years: [2026], months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, income: 0, expenses: 0 })) };

describe('SummaryTabComponent', () => {
  let h: ComponentHarness<SummaryTabComponent>;

  async function mount(body: EstateDashboardSummary | { status: number }, estate: Estate | null = null) {
    h = setupComponent(SummaryTabComponent);
    h.component.estateId = 'e1';
    h.component.estate = estate;
    h.fixture.detectChanges();
    const req = h.http.expectOne(`${API}/estates/e1/dashboard/summary`);
    if ('status' in body) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    // La tarjeta de ingresos vs. gastos pide lo suyo (se prueba en su propio spec).
    h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/cashflow`).flush(EMPTY_CASHFLOW);
    await settle();
    h.fixture.detectChanges();
    // ...y el reparto de gastos pide el mismo ejercicio que eligió esa tarjeta.
    const breakdown = h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/expense-breakdown`);
    expect(breakdown.request.params.get('year')).toBe('2026');
    breakdown.flush({ year: 2026, total: 0, categories: [] });
    h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/milestones`).flush({ items: [] });
    h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/activity`).flush({ items: [] });
    h.http.expectOne((r) => r.url === `${API}/estates/e1/dashboard/properties`).flush({ total: 0, items: [] });
    await settle();
    h.fixture.detectChanges();
  }

  const kpi = (id: string) => h.el.querySelector(`[data-kpi="${id}"]`) as HTMLButtonElement;
  const text = (id: string, sel: string) => kpi(id).querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim();

  afterEach(() => h.http.verify());

  it('pinta los cinco indicadores con los datos del servidor', async () => {
    await mount(SUMMARY);
    expect(h.el.querySelectorAll('[data-kpi]')).toHaveLength(5);
    expect(text('units', '.kpi__value')).toBe('24');
    expect(text('balance', '.kpi__value')).toMatch(/^12\.450,00\s?€$/);
    expect(text('issues', '.kpi__value')).toBe('2');
    expect(text('issues', '.kpi__sub')).toBe('de 12 este año');
    expect(text('dues', '.kpi__value')).toMatch(/^1\.250,00\s?€$/);
    expect(text('dues', '.kpi__sub')).toBe('en 2 propiedades');
    expect(text('meeting', '.kpi__value')).toContain('2026');
    expect(text('meeting', '.kpi__sub')).toBe('Ordinaria');
  });

  it('el tono del saldo y de las cuotas refleja su signo', async () => {
    await mount({ ...SUMMARY, balance: -300, pendingDues: { amount: 0, properties: 0 } });
    expect(kpi('balance').querySelector('.kpi')?.classList.contains('kpi--danger')).toBe(true);
    expect(kpi('dues').querySelector('.kpi')?.classList.contains('kpi--default')).toBe(true);
    expect(text('dues', '.kpi__sub')).toBe('ninguna propiedad');
  });

  it('sin junta convocada lo dice en vez de inventar una fecha', async () => {
    await mount({ ...SUMMARY, nextMeeting: null });
    expect(text('meeting', '.kpi__value')).toBe('—');
    expect(text('meeting', '.kpi__sub')).toBe('Sin junta convocada');
  });

  it('una sola propiedad con deuda usa el singular', async () => {
    await mount({ ...SUMMARY, pendingDues: { amount: 80, properties: 1 } });
    expect(text('dues', '.kpi__sub')).toBe('en 1 propiedad');
  });

  it('cada indicador lleva a su sección, incluidas las que ya no tienen pestaña', async () => {
    await mount(SUMMARY);
    const opened: EstateTab[] = [];
    h.component.openTab.subscribe((t) => opened.push(t));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    kpi('units').click();
    kpi('issues').click();
    kpi('meeting').click();
    expect(opened).toEqual(['properties', 'issues', 'juntas']);

    kpi('balance').click();
    kpi('dues').click();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith(['/b/accounting', 'e1']);
  });

  it('si falla la carga muestra "—" y un aviso, sin romper la pestaña', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ status: 500 });
    expect(text('units', '.kpi__value')).toBe('—');
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
    expect(h.el.querySelector('.kpis')?.getAttribute('aria-busy')).toBe('false');
  });

  describe('tarjeta de presentación', () => {
    it('sin finca no pinta la tarjeta', async () => {
      await mount(SUMMARY, null);
      expect(h.el.querySelector('.hero')).toBeNull();
    });

    it('muestra nombre, dirección y la descripción de la comunidad', async () => {
      await mount(SUMMARY, makeEstate({ description: 'Comunidad residencial en el centro, con 24 propiedades.' }));
      expect(h.el.querySelector('.hero__name')?.textContent?.trim()).toBe('Residencial Plaza');
      expect(h.el.querySelector('.hero__address')?.textContent?.trim()).toBe('Calle Gran Vía 12, Madrid');
      expect(h.el.querySelector('.hero__description')?.textContent).toContain('centro, con 24 propiedades');
      expect(h.el.querySelector('.hero__link')).toBeNull();
    });

    it('sin descripción invita a añadirla y lleva a editar la finca', async () => {
      await mount(SUMMARY, makeEstate({ description: null }));
      const edit = vi.fn();
      h.component.editEstate.subscribe(edit);
      expect(h.el.querySelector('.hero__description')?.textContent).toContain('Aún no hay una descripción');
      (h.el.querySelector('.hero__link') as HTMLButtonElement).click();
      expect(edit).toHaveBeenCalledTimes(1);
    });

    it('"Añadir propiedad" emite y "Ver contabilidad" abre la contabilidad de la finca', async () => {
      await mount(SUMMARY, makeEstate());
      const add = vi.fn();
      h.component.addProperty.subscribe(add);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const button = (text: string) => Array.from(h.el.querySelectorAll('.hero__actions button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement;

      button('Añadir propiedad').click();
      button('Ver contabilidad').click();

      expect(add).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(['/b/accounting', 'e1']);
    });

    it('con fachada del Catastro la pinta; sin ella, el icono de respaldo', async () => {
      await mount(SUMMARY, makeEstate({ catastroFacadeUrl: 'https://catastro.test/f.jpg' }));
      expect(h.el.querySelector('.hero__media img')?.getAttribute('src')).toBe('https://catastro.test/f.jpg');
    });
  });

  describe('últimas propiedades', () => {
    const PROPS = { total: 40, items: [{ id: 'p9', ref: '5B', type: 'Piso', titular: 'Antonio Pérez Lorente', quotaMonthly: 150.12, balance: 450.36, openIssues: 0, status: 'overdue' }] };

    async function mountWithProperties() {
      h = setupComponent(SummaryTabComponent);
      h.component.estateId = 'e1';
      h.fixture.detectChanges();
      h.http.match((r) => r.url.endsWith('/dashboard/properties')).forEach((req) => req.flush(PROPS));
      for (const path of ['summary', 'cashflow', 'expense-breakdown', 'milestones', 'activity']) {
        h.http.match((r) => r.url.endsWith(`/dashboard/${path}`)).forEach((req) => req.flush(
          path === 'summary' ? SUMMARY : path === 'cashflow' ? EMPTY_CASHFLOW : path === 'expense-breakdown' ? { year: 2026, total: 0, categories: [] } : { items: [] },
        ));
      }
      await settle();
      h.fixture.detectChanges();
      h.http.match((r) => r.url.endsWith('/dashboard/expense-breakdown')).forEach((req) => req.flush({ year: 2026, total: 0, categories: [] }));
    }

    it('"Ver propiedad" y "Ver todas" suben al padre: abrir una propiedad / ir a la pestaña Propiedades', async () => {
      await mountWithProperties();
      const opened: string[] = [];
      const tabs: EstateTab[] = [];
      h.component.openProperty.subscribe((id) => opened.push(id));
      h.component.openTab.subscribe((t) => tabs.push(t));

      (h.el.querySelector('[data-property="p9"] .recent__open') as HTMLButtonElement).click();
      (h.el.querySelector('app-properties-card .section-card__action') as HTMLButtonElement).click();

      expect(opened).toEqual(['p9']);
      expect(tabs).toEqual(['properties']);
    });
  });
});
