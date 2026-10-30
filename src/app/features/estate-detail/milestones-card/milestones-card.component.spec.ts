import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateMilestone } from '../../../core/estate-dashboard.models';
import type { EstateTab } from '../../../core/estate-navigation.service';
import { MilestonesCardComponent } from './milestones-card.component';

const ITEMS: EstateMilestone[] = [
  { key: 'inspection:i1', kind: 'inspection', title: 'Inspección de ascensor · Ascensor portal 1', date: '2026-09-20', overdue: true },
  { key: 'meeting:m1', kind: 'meeting', title: 'Junta ordinaria de propietarios', date: '2026-11-15T18:00:00.000Z', overdue: false },
  { key: 'contract:c1', kind: 'contract', title: 'Vence contrato de Seguros Credimar S.L. (Seguro del edificio)', date: '2026-12-30', overdue: false },
];

describe('MilestonesCardComponent', () => {
  let h: ComponentHarness<MilestonesCardComponent>;
  const url = `${API}/estates/e1/dashboard/milestones`;

  async function mount(body: { items: EstateMilestone[] } | { status: number }) {
    h = setupComponent(MilestonesCardComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    const req = h.http.expectOne(url);
    if ('status' in body) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    await settle();
    h.fixture.detectChanges();
  }

  const row = (key: string) => h.el.querySelector(`[data-milestone="${key}"]`) as HTMLButtonElement;

  afterEach(() => h.http.verify());

  it('pinta cada hito con su título y su fecha', async () => {
    await mount({ items: ITEMS });
    expect(h.el.querySelectorAll('[data-milestone]')).toHaveLength(3);
    expect(row('meeting:m1').querySelector('.milestones__title')?.textContent?.trim()).toBe('Junta ordinaria de propietarios');
    expect(row('meeting:m1').querySelector('.milestones__date')?.textContent).toMatch(/15\s+nov\.?\s+2026/);
  });

  it('una fecha de día no se desplaza por la zona horaria (YYYY-MM-DD se lee como día de calendario)', async () => {
    await mount({ items: [{ key: 'contract:c1', kind: 'contract', title: 'x', date: '2026-12-30', overdue: false }] });
    expect(row('contract:c1').querySelector('.milestones__date')?.textContent).toMatch(/^\s*30\s+dic\.?\s+2026\s*$/);
  });

  it('lo vencido sale marcado; el primer hito pendiente es "Próximo" y el resto "Programado"', async () => {
    await mount({ items: ITEMS });
    const pill = (key: string) => row(key).querySelector('app-status-pill')?.textContent?.trim();
    expect(pill('inspection:i1')).toBe('Vencido');
    expect(pill('meeting:m1')).toBe('Próximo');
    expect(pill('contract:c1')).toBe('Programado');
    expect(row('inspection:i1').querySelector('.pill--danger')).not.toBeNull();
    expect(row('meeting:m1').querySelector('.pill--info')).not.toBeNull();
  });

  it('si todo está vencido nadie se destaca como "Próximo"', async () => {
    await mount({ items: [{ ...ITEMS[0] }, { ...ITEMS[0], key: 'inspection:i2' }] });
    expect(h.el.querySelector('.pill--info')).toBeNull();
    expect(h.el.querySelectorAll('.pill--danger')).toHaveLength(2);
  });

  it('cada hito lleva a la sección donde se gestiona', async () => {
    await mount({ items: ITEMS });
    const opened: EstateTab[] = [];
    h.component.openTab.subscribe((t) => opened.push(t));
    row('meeting:m1').click();
    row('inspection:i1').click();
    row('contract:c1').click();
    expect(opened).toEqual(['juntas', 'inspections', 'contracts']);
  });

  it('sin hitos explica por qué está vacío', async () => {
    await mount({ items: [] });
    expect(h.el.querySelector('.milestones')).toBeNull();
    expect(h.el.textContent).toContain('No hay hitos próximos');
  });

  it('si falla la carga muestra un aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ status: 500 });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
  });
});
