import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { EstateActivityItem } from '../../../core/estate-dashboard.models';
import { PropertyChangesCardComponent } from './property-changes-card.component';

const item = (id: string, overrides: Partial<EstateActivityItem> = {}): EstateActivityItem => ({
  id, verb: 'created', subjectType: 'membership', summary: `Cambio ${id}`, occurredAt: new Date().toISOString(),
  actorName: 'Laura Gómez', propertyRef: '2ºA', ...overrides,
});

describe('PropertyChangesCardComponent', () => {
  let h: ComponentHarness<PropertyChangesCardComponent>;
  const url = `${API}/estates/e1/dashboard/activity`;

  const answer = async (body: unknown, status = 200) => {
    const req = h.http.expectOne((r) => r.url === url);
    if (status === 200) req.flush(body as object);
    else req.flush({ message: 'x' }, { status, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    return req.request;
  };
  const mount = () => {
    h = setupComponent(PropertyChangesCardComponent);
    h.component.estateId = 'e1';
    h.fixture.detectChanges();
  };

  afterEach(() => h.http.verify());

  it('pide solo altas de propiedades y titularidades, las 5 últimas, y las lista con quién y a qué propiedad', async () => {
    mount();
    const req = await answer({ items: [item('a'), item('b', { subjectType: 'property', propertyRef: null, actorName: null })] });
    expect(req.params.get('subjects')).toBe('property,membership');
    expect(req.params.get('limit')).toBe('5');
    expect(h.el.querySelectorAll('[data-change]')).toHaveLength(2);
    expect(h.el.querySelector('[data-change="a"]')?.textContent).toContain('Prop. 2ºA · por Laura Gómez');
    expect(h.el.querySelector('[data-change="b"] .changes__detail')).toBeNull();
    expect(h.el.querySelector('[data-change="a"] .changes__time')?.textContent).toContain('Hoy');
  });

  it('"Ver todos" pide más (15) y pasa a "Ver menos"', async () => {
    mount();
    await answer({ items: [item('a')] });
    expect(h.el.querySelector('.section-card__action')?.textContent).toContain('Ver todos');

    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    const req = await answer({ items: [item('a'), item('b'), item('c')] });
    expect(req.params.get('limit')).toBe('15');
    expect(h.el.querySelectorAll('[data-change]')).toHaveLength(3);
    expect(h.el.querySelector('.section-card__action')?.textContent).toContain('Ver menos');
  });

  it('si "Ver todos" falla, se conserva la lista que ya había', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount();
    await answer({ items: [item('a')] });
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    await answer(null, 500);
    expect(h.el.querySelectorAll('[data-change]')).toHaveLength(1);
    expect(h.el.querySelector('[role="alert"]')).toBeNull();
  });

  it('sin actividad lo dice', async () => {
    mount();
    await answer({ items: [] });
    expect(h.el.textContent).toContain('Todavía no hay altas ni cambios');
  });

  it('si falla la primera carga muestra un aviso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mount();
    await answer(null, 500);
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
  });
});
