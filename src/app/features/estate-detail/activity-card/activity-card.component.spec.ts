import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateActivityItem } from '../../../core/estate-dashboard.models';
import { ActivityCardComponent, activityTimeLabel, type ActivityTarget } from './activity-card.component';

function item(overrides: Partial<EstateActivityItem> = {}): EstateActivityItem {
  return {
    id: 'a1', verb: 'created', subjectType: 'issue', summary: 'Nueva incidencia: avería en ascensor',
    occurredAt: new Date().toISOString(), actorName: 'Ana García', propertyRef: '5B', ...overrides,
  };
}

describe('activityTimeLabel', () => {
  // Fechas locales (el formato depende de la zona horaria del navegador): se construyen con componentes locales.
  const now = new Date(2026, 9, 15, 12, 0);

  it('hoy, ayer y fechas anteriores', () => {
    expect(activityTimeLabel(new Date(2026, 9, 15, 10, 24).toISOString(), now)).toBe('Hoy, 10:24');
    expect(activityTimeLabel(new Date(2026, 9, 14, 16, 30).toISOString(), now)).toBe('Ayer, 16:30');
    expect(activityTimeLabel(new Date(2026, 3, 12, 11, 20).toISOString(), now)).toMatch(/^12\s+abr\.?,\s+11:20$/);
  });

  it('"ayer" cuenta por día natural: 00:30 de hoy no es "ayer" aunque hayan pasado menos de 24 h', () => {
    const late = new Date(2026, 9, 14, 23, 50).toISOString();
    expect(activityTimeLabel(late, new Date(2026, 9, 15, 0, 30))).toBe('Ayer, 23:50');
    expect(activityTimeLabel(new Date(2026, 9, 15, 0, 10).toISOString(), new Date(2026, 9, 15, 0, 30))).toBe('Hoy, 00:10');
  });
});

describe('ActivityCardComponent', () => {
  let h: ComponentHarness<ActivityCardComponent>;
  const url = `${API}/estates/e1/dashboard/activity`;

  async function mount(body: { items: EstateActivityItem[] } | { status: number }) {
    h = setupComponent(ActivityCardComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
    const req = h.http.expectOne((r) => r.url === url);
    expect(req.request.params.get('limit')).toBe('5'); // la tarjeta pide solo lo que muestra
    if ('status' in body) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    await settle();
    h.fixture.detectChanges();
  }

  const row = (id: string) => h.el.querySelector(`[data-activity="${id}"]`) as HTMLButtonElement;

  afterEach(() => h.http.verify());

  it('pinta cada entrada con su resumen, la propiedad, quién lo hizo y cuándo', async () => {
    await mount({ items: [item()] });
    expect(row('a1').querySelector('.activity__summary')?.textContent?.trim()).toBe('Nueva incidencia: avería en ascensor');
    expect(row('a1').querySelector('.activity__detail')?.textContent?.trim()).toBe('Prop. 5B · Ana García');
    expect(row('a1').querySelector('.activity__time')?.textContent?.trim()).toMatch(/^Hoy, \d{2}:\d{2}$/);
  });

  it('sin propiedad ni autor no pinta la línea de detalle', async () => {
    await mount({ items: [item({ propertyRef: null, actorName: null })] });
    expect(row('a1').querySelector('.activity__detail')).toBeNull();
  });

  it('cada tipo de actividad lleva a su sección o a la contabilidad', async () => {
    await mount({
      items: [
        item({ id: 'i', subjectType: 'issue' }),
        item({ id: 'r', subjectType: 'receipt' }),
        item({ id: 'm', subjectType: 'meeting' }),
        item({ id: 'd', subjectType: 'document' }),
        item({ id: 'p', subjectType: 'property' }),
        item({ id: 'f', subjectType: 'fiscal_year' }),
      ],
    });
    const opened: ActivityTarget[] = [];
    h.component.openTarget.subscribe((t) => opened.push(t));
    for (const id of ['i', 'r', 'm', 'd', 'p', 'f']) row(id).click();
    expect(opened).toEqual(['issues', 'accounting', 'juntas', 'documents', 'properties', 'accounting']);
  });

  it('sin actividad lo dice', async () => {
    await mount({ items: [] });
    expect(h.el.textContent).toContain('Todavía no hay actividad');
  });

  it('si falla la carga muestra un aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ status: 500 });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar');
  });
});
