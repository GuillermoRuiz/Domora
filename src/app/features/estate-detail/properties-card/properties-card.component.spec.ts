import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateRecentProperties } from '../../../core/estate-dashboard.models';
import { PropertiesCardComponent } from './properties-card.component';

const DATA: EstateRecentProperties = {
  total: 24,
  items: [
    { id: 'p1', ref: '1ºA', type: 'Piso', titular: 'García López, Antonio', quotaMonthly: 120, balance: 0, status: 'ok' },
    { id: 'p2', ref: '2ºA', type: 'Piso', titular: 'Sánchez Torres, Manuel', quotaMonthly: 120, balance: 1240, status: 'overdue' },
    { id: 'p3', ref: 'L1', type: 'Local', titular: null, quotaMonthly: 180.5, balance: 80, status: 'overdue' },
  ],
};

describe('PropertiesCardComponent', () => {
  let h: ComponentHarness<PropertiesCardComponent>;
  const url = `${API}/estates/e1/dashboard/properties`;

  async function mount(body: EstateRecentProperties | { status: number }) {
    h = setupComponent(PropertiesCardComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    const req = h.http.expectOne((r) => r.url === url);
    if ('status' in body) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    await settle();
    h.fixture.detectChanges();
  }

  const row = (id: string) => h.el.querySelector(`[data-property="${id}"]`) as HTMLElement;
  const cells = (id: string) => Array.from(row(id).querySelectorAll('td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim());

  afterEach(() => h.http.verify());

  it('una fila por propiedad con ref, tipo, titular, estado, cuota y saldo', async () => {
    await mount(DATA);
    expect(h.el.querySelectorAll('[data-property]')).toHaveLength(3);
    const [ref, type, titular, status, quota, balance] = cells('p2');
    expect([ref, type, titular, status]).toEqual(['2ºA', 'Vivienda', 'Sánchez Torres, Manuel', 'En mora']);
    expect(quota).toMatch(/^120,00\s?€$/);
    expect(balance).toMatch(/^1\.240,00\s?€$/);
  });

  it('el estado usa texto y tono: al día (positivo) y en mora (aviso)', async () => {
    await mount(DATA);
    expect(row('p1').querySelector('.pill--positive')?.textContent).toContain('Al día');
    expect(row('p3').querySelector('.pill--warning')?.textContent).toContain('En mora');
    expect(row('p2').querySelector('.pill--warning')?.textContent).toContain('En mora');
  });

  it('sin titular muestra un guion; el saldo solo se resalta si hay deuda', async () => {
    await mount(DATA);
    expect(cells('p3')[2]).toBe('—');
    expect(row('p3').querySelector('.recent__num--owes')).not.toBeNull();
    expect(row('p1').querySelector('.recent__num--owes')).toBeNull();
  });

  it('el título refleja cuántas filas hay y "Ver todas" indica el total si hay más', async () => {
    await mount(DATA);
    expect(h.el.querySelector('.section-card__title')?.textContent?.trim()).toBe('Propiedades (últimas 3)');
    expect(h.el.querySelector('.section-card__action')?.textContent).toContain('Ver todas (24)');
  });

  it('"Ver propiedad" emite el id y "Ver todas" emite viewAll', async () => {
    await mount(DATA);
    const opened: string[] = [];
    const viewAll = vi.fn();
    h.component.openProperty.subscribe((id) => opened.push(id));
    h.component.viewAll.subscribe(viewAll);

    (row('p2').querySelector('.recent__open') as HTMLButtonElement).click();
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();

    expect(opened).toEqual(['p2']);
    expect(viewAll).toHaveBeenCalledTimes(1);
  });

  it('sin propiedades lo dice, y si falla la carga muestra un aviso', async () => {
    await mount({ total: 0, items: [] });
    expect(h.el.textContent).toContain('aún no tiene propiedades');
  });

  it('si falla la carga muestra un aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ status: 500 });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
  });
});
