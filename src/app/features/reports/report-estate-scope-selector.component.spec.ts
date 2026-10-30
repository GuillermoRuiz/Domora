import { ComponentHarness, setupComponent } from '../../core/testing/component-harness';
import { ReportEstateScopeSelectorComponent } from './report-estate-scope-selector.component';

describe('ReportEstateScopeSelectorComponent', () => {
  let h: ComponentHarness<ReportEstateScopeSelectorComponent>;
  beforeEach(() => {
    h = setupComponent(ReportEstateScopeSelectorComponent);
    h.component.estates = [{ id: 'e1', name: 'Sol', address: 'Calle Sol', streetNumber: '1', location: 'Madrid' }, { id: 'e2', name: 'Águila' }];
    h.component.value = { scopeMode: 'selected', estateIds: [] };
  });
  it('selecciona varios IDs, busca sin tildes y permite volver a todas', () => {
    const changed = vi.fn(); h.component.valueChange.subscribe(value => { changed(value); h.component.value = value; });
    h.component.toggleEstate('e1', true); h.component.toggleEstate('e2', true);
    expect(changed).toHaveBeenLastCalledWith({ scopeMode: 'all', estateIds: [] });
    h.component.search.set('aguila');
    expect(h.component.visibleEstates().map(e => e.id)).toEqual(['e2']);
    h.component.toggleAll(true); expect(changed).toHaveBeenLastCalledWith({ scopeMode: 'all', estateIds: [] });
  });
  it('ofrece un único selector con buscador, "Todas mis comunidades" y filas con dirección', () => {
    h.component.value = { scopeMode: 'all', estateIds: [] };
    h.component.valueChange.subscribe(value => h.component.value = value);
    h.fixture.detectChanges();
    expect(h.el.querySelector('select')).toBeNull();
    h.el.querySelector<HTMLButtonElement>('.scope-trigger')!.click(); h.fixture.detectChanges();
    const panel = h.el.querySelector('.scope-panel')!;
    expect(panel.querySelector('input[type=search]')).not.toBeNull();
    const all = panel.querySelector<HTMLButtonElement>('.scope-all')!;
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect([...panel.querySelectorAll<HTMLButtonElement>('.scope-estate')].every(row => row.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(h.el.querySelector('.scope-clear')).toBeNull();
    expect(panel.querySelector('.scope-estate small')?.textContent).toBe('Calle Sol 1, Madrid');
    panel.querySelector<HTMLButtonElement>('.scope-estate')!.click(); h.fixture.detectChanges();
    expect(h.component.value).toEqual({ scopeMode: 'selected', estateIds: ['e1'] });
    all.click(); h.fixture.detectChanges();
    expect(h.component.value).toEqual({ scopeMode: 'all', estateIds: [] });
    expect(h.el.querySelectorAll('.scope-trigger')).toHaveLength(1);
  });
  it('desde Todas, elegir una comunidad la deja sola; al completar el resto vuelve a Todas', () => {
    h.component.value = { scopeMode: 'all', estateIds: [] };
    h.component.valueChange.subscribe(value => h.component.value = value);
    h.component.toggleEstate('e2', true);
    expect(h.component.value).toEqual({ scopeMode: 'selected', estateIds: ['e2'] });
    h.fixture.detectChanges(); h.el.querySelector<HTMLButtonElement>('.scope-trigger')!.click(); h.fixture.detectChanges();
    expect(h.el.querySelector('.scope-all')!.getAttribute('aria-pressed')).toBe('false');
    h.component.toggleEstate('e1', true);
    expect(h.component.value).toEqual({ scopeMode: 'all', estateIds: [] });
    h.component.search.set('aguila');
    h.component.toggleAll(false);
    expect(h.component.value.estateIds).toEqual([]);
    h.component.toggleAll(true);
    expect(h.component.value).toEqual({ scopeMode: 'all', estateIds: [] });
  });
  it('cierra al elegir una comunidad única o pulsar fuera, conservando los IDs elegidos', () => {
    h.component.single = true;
    h.component.valueChange.subscribe(value => h.component.value = value);
    h.fixture.detectChanges();
    h.el.querySelector<HTMLButtonElement>('.scope-trigger')!.click(); h.fixture.detectChanges();
    h.el.querySelector<HTMLButtonElement>('.scope-estate')!.click(); h.fixture.detectChanges();
    expect(h.component.value.estateIds).toEqual(['e1']);
    expect(h.el.querySelector('.scope-panel')).toBeNull();
    h.el.querySelector<HTMLButtonElement>('.scope-trigger')!.click(); h.fixture.detectChanges();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); h.fixture.detectChanges();
    expect(h.el.querySelector('.scope-panel')).toBeNull();
    expect(h.component.value.estateIds).toEqual(['e1']);
  });
  it('una comunidad reemplaza la selección y no ofrece Todas', () => {
    h.component.single = true;
    const changed = vi.fn(); h.component.valueChange.subscribe(value => { changed(value); h.component.value = value; });
    h.component.toggleEstate('e1', true); h.component.toggleEstate('e2', true);
    h.fixture.detectChanges();
    expect(changed).toHaveBeenLastCalledWith({ scopeMode: 'selected', estateIds: ['e2'] });
    expect(h.el.textContent).not.toContain('Todas mis comunidades');
  });
  it('Escape cierra el panel y devuelve el foco al botón', () => {
    h.fixture.detectChanges(); const trigger = h.el.querySelector<HTMLButtonElement>('.scope-trigger')!;
    trigger.click(); h.fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    h.el.querySelector('.scope-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    h.fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(h.el.querySelector('.scope-panel')).toBeNull();
  });
  it('Escape también cierra con el foco fuera del panel (Safari no enfoca los checkboxes al hacer clic)', () => {
    h.fixture.detectChanges(); const trigger = h.el.querySelector<HTMLButtonElement>('.scope-trigger')!;
    trigger.click(); h.fixture.detectChanges();
    (document.activeElement as HTMLElement | null)?.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('.scope-panel')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
