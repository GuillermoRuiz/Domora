import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { ScopeGroup } from '../../../core/owner-scope.service';
import { CommunityScopeSelectorComponent } from './community-scope-selector.component';

const GROUPS: ScopeGroup[] = [
  { estateId: 'e1', estateName: 'Colón 24', properties: [
    { id: 'p1', nickname: '3A', addressFull: 'Calle Colón 24, 3A', estateId: 'e1', estateName: 'Colón 24', isLinked: true },
    { id: 'p2', nickname: 'P03', addressFull: 'Calle Colón 24, P03', estateId: 'e1', estateName: 'Colón 24', isLinked: true },
  ] },
  { estateId: 'e2', estateName: 'Cuba 18', properties: [
    { id: 'p3', nickname: '1A', addressFull: 'Calle Cuba 18, 1A', estateId: 'e2', estateName: 'Cuba 18', isLinked: true },
  ] },
  { estateId: null, estateName: 'Sin comunidad vinculada', properties: [
    { id: 'p4', nickname: 'Mi piso', addressFull: 'Calle X 1', estateId: null, estateName: null, isLinked: false },
  ] },
];

describe('CommunityScopeSelectorComponent', () => {
  let h: ComponentHarness<CommunityScopeSelectorComponent>;

  function mount(selectedId: string | null = 'p1', groups: ScopeGroup[] = GROUPS): void {
    h = setupComponent(CommunityScopeSelectorComponent);
    h.fixture.componentRef.setInput('groups', groups);
    h.fixture.componentRef.setInput('selectedId', selectedId);
    h.fixture.detectChanges();
  }
  const button = () => h.el.querySelector('.scope__btn') as HTMLButtonElement;
  const open = () => { button().click(); h.fixture.detectChanges(); };
  const option = (id: string) => h.el.querySelector(`[data-property="${id}"]`) as HTMLButtonElement;

  it('cerrado, muestra la propiedad elegida y su finca', () => {
    mount('p3');
    expect(h.el.querySelector('.scope__name')?.textContent?.trim()).toBe('1A');
    expect(h.el.querySelector('.scope__sub')?.textContent?.trim()).toBe('Calle Cuba 18, 1A');
    expect(h.el.querySelector('.scope__panel')).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('una propiedad sin finca se distingue por su dirección y queda en su propio grupo', () => {
    mount('p4');
    expect(h.el.querySelector('.scope__sub')?.textContent?.trim()).toBe('Calle X 1');
    open();
    expect(h.el.querySelector('[data-group="none"]')?.textContent?.trim()).toBe('Sin comunidad vinculada');
  });

  it('sin selección pide elegir una', () => {
    mount(null);
    expect(h.el.querySelector('.scope__name')?.textContent?.trim()).toBe('Elige una propiedad');
  });

  it('al abrirlo lista las propiedades agrupadas por finca, marca la elegida y ofrece añadir otra', () => {
    mount('p2');
    open();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(Array.from(h.el.querySelectorAll('.scope__group')).map(g => g.textContent?.trim())).toEqual(['Colón 24', 'Cuba 18', 'Sin comunidad vinculada']);
    expect(h.el.querySelectorAll('[role="option"]')).toHaveLength(4);
    expect(option('p2').getAttribute('aria-selected')).toBe('true');
    expect(option('p1').getAttribute('aria-selected')).toBe('false');
    expect(h.el.querySelector('[data-action="add-property"]')?.textContent).toContain('Añadir propiedad');
  });

  describe('«Todas mis propiedades»', () => {
    function mountAll(selectedId: string | null): void {
      h = setupComponent(CommunityScopeSelectorComponent);
      h.fixture.componentRef.setInput('groups', GROUPS);
      h.fixture.componentRef.setInput('selectedId', selectedId);
      h.fixture.componentRef.setInput('showAll', true);
      h.fixture.detectChanges();
    }

    it('sin propiedad elegida, cerrado dice «Todas mis propiedades» y cuántas son', () => {
      mountAll(null);
      expect(h.el.querySelector('.scope__name')?.textContent?.trim()).toBe('Todas mis propiedades');
      expect(h.el.querySelector('.scope__sub')?.textContent?.trim()).toBe('4 propiedades');
    });

    it('la lista la ofrece primero y la marca si es la vista actual', () => {
      mountAll(null);
      open();
      const options = Array.from(h.el.querySelectorAll('[role="option"]'));
      expect(options).toHaveLength(5);
      expect(options[0].getAttribute('data-property')).toBe('all');
      expect(option('all').getAttribute('aria-selected')).toBe('true');
    });

    it('elegirla desde una propiedad avisa con null', () => {
      mountAll('p1');
      const chosen: (string | null)[] = [];
      h.component.choose.subscribe(id => chosen.push(id));
      open();
      option('all').click();
      expect(chosen).toEqual([null]);
    });

    it('sin showAll no aparece', () => {
      mount('p1');
      open();
      expect(option('all')).toBeNull();
    });
  });

  it('elegir otra propiedad avisa con su id y cierra la lista', () => {
    mount('p1');
    const chosen: (string | null)[] = [];
    h.component.choose.subscribe(id => chosen.push(id));
    open();
    option('p3').click();
    h.fixture.detectChanges();
    expect(chosen).toEqual(['p3']);
    expect(h.el.querySelector('.scope__panel')).toBeNull();
  });

  it('elegir la propiedad que ya está elegida solo cierra la lista', () => {
    mount('p1');
    const chosen: (string | null)[] = [];
    h.component.choose.subscribe(id => chosen.push(id));
    open();
    option('p1').click();
    h.fixture.detectChanges();
    expect(chosen).toEqual([]);
    expect(h.el.querySelector('.scope__panel')).toBeNull();
  });

  it('«Añadir propiedad» avisa y cierra la lista', () => {
    mount('p1');
    let added = 0;
    h.component.addProperty.subscribe(() => added++);
    open();
    (h.el.querySelector('[data-action="add-property"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(added).toBe(1);
    expect(h.el.querySelector('.scope__panel')).toBeNull();
  });

  it('pulsar fuera (el fondo) o Escape cierra la lista sin elegir nada', () => {
    mount('p1');
    open();
    (h.el.querySelector('.scope__backdrop') as HTMLElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.scope__panel')).toBeNull();

    open();
    (h.el.querySelector('.scope') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('.scope__panel')).toBeNull();
  });
});
