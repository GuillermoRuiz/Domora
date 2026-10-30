import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DropdownComponent, DropdownItem } from './dropdown.component';

const SIZES: DropdownItem[] = [
  { id: 1, label: 'Small' },
  { id: 2, label: 'Medium' },
  { id: 3, label: 'Large' },
  { id: 4, label: 'Extra Large', icon: 'phone' },
];

interface Setup {
  fixture: ComponentFixture<DropdownComponent>;
  el: HTMLElement;
  emitted: DropdownItem[];
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  options: () => HTMLElement[];
  key: (key: string) => KeyboardEvent;
  set: (name: string, value: unknown) => void;
}

function setup(inputs: Record<string, unknown> = {}): Setup {
  TestBed.configureTestingModule({ imports: [DropdownComponent] });
  const fixture = TestBed.createComponent(DropdownComponent);
  const emitted: DropdownItem[] = [];
  fixture.componentInstance.selectionChange.subscribe((i) => emitted.push(i));
  const set = (name: string, value: unknown) => {
    fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  };
  set('items', SIZES);
  set('label', 'Choose a size');
  for (const [k, v] of Object.entries(inputs)) set(k, v);

  const el = fixture.nativeElement as HTMLElement;
  const trigger = el.querySelector<HTMLButtonElement>('.dd__trigger')!;
  const key = (k: string) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    trigger.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  return {
    fixture, el, emitted, trigger, set, key,
    panel: el.querySelector<HTMLElement>('.dd__panel')!,
    options: () => Array.from(el.querySelectorAll<HTMLElement>('.dd__option')),
  };
}

const isOpen = (s: Setup) => s.trigger.getAttribute('aria-expanded') === 'true';
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('DropdownComponent', () => {
  it('sin selección muestra el texto de ayuda (label) en gris', () => {
    const s = setup();
    expect(text(s.el.querySelector('.dd__value'))).toBe('Choose a size');
    expect(s.el.querySelector('.dd__value--placeholder')).not.toBeNull();
  });

  it('muestra la etiqueta de la opción seleccionada y marca esa opción con aria-selected y el check', () => {
    const s = setup({ selectedId: 2 });
    expect(text(s.el.querySelector('.dd__value'))).toBe('Medium');
    expect(s.el.querySelector('.dd__value--placeholder')).toBeNull();
    expect(s.options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false', 'false']);
    expect(s.options()[1].classList).toContain('dd__option--selected');
    expect(s.options()[1].querySelector('.dd__check')).not.toBeNull();
    expect(s.el.querySelectorAll('.dd__check').length).toBe(1);
  });

  it('un selectedId que no está entre las opciones cae al texto de ayuda', () => {
    const s = setup({ selectedId: 99 });
    expect(text(s.el.querySelector('.dd__value'))).toBe('Choose a size');
  });

  it('el botón abre y cierra el menú y expone el estado por ARIA', () => {
    const s = setup();
    expect(isOpen(s)).toBe(false);
    expect(s.trigger.getAttribute('role')).toBe('combobox');
    expect(s.trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(s.trigger.getAttribute('aria-controls')).toBe(s.panel.id);
    expect(s.panel.getAttribute('role')).toBe('listbox');

    s.trigger.click();
    s.fixture.detectChanges();
    expect(isOpen(s)).toBe(true);
    expect(s.panel.classList).toContain('dd__panel--open');
    expect(s.el.classList).toContain('dropdown--open');

    s.trigger.click();
    s.fixture.detectChanges();
    expect(isOpen(s)).toBe(false);
    expect(s.panel.classList).not.toContain('dd__panel--open');
  });

  it('elegir una opción emite el item, cierra el menú y devuelve el foco al botón', () => {
    const s = setup();
    document.body.appendChild(s.el);
    s.trigger.click();
    s.fixture.detectChanges();

    s.options()[2].click();
    s.fixture.detectChanges();

    expect(s.emitted).toEqual([SIZES[2]]);
    expect(isOpen(s)).toBe(false);
    expect(document.activeElement).toBe(s.trigger);
    s.el.remove();
  });

  it('es controlado: tras elegir no cambia lo mostrado hasta que el padre actualiza selectedId', () => {
    const s = setup({ selectedId: 1 });
    s.trigger.click();
    s.options()[2].click();
    s.fixture.detectChanges();
    expect(text(s.el.querySelector('.dd__value'))).toBe('Small');

    s.set('selectedId', 3);
    expect(text(s.el.querySelector('.dd__value'))).toBe('Large');
    s.set('selectedId', null);
    expect(text(s.el.querySelector('.dd__value'))).toBe('Choose a size');
  });

  it('elegir la opción ya seleccionada solo cierra: no vuelve a emitir', () => {
    const s = setup({ selectedId: 2 });
    s.trigger.click();
    s.fixture.detectChanges();
    s.options()[1].click();
    s.fixture.detectChanges();
    expect(s.emitted).toEqual([]);
    expect(isOpen(s)).toBe(false);
  });

  it('un clic fuera del componente cierra el menú; uno dentro no', () => {
    const s = setup();
    s.trigger.click();
    s.fixture.detectChanges();

    s.panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    s.fixture.detectChanges();
    expect(isOpen(s)).toBe(true);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    s.fixture.detectChanges();
    expect(isOpen(s)).toBe(false);
  });

  it('Escape cierra solo el menú, devuelve el foco al botón y no se propaga al contenedor', () => {
    const s = setup();
    document.body.appendChild(s.el);
    const parentSaw: string[] = [];
    document.addEventListener('keydown', (e) => parentSaw.push(e.key), { once: true });
    s.key('Enter');
    expect(isOpen(s)).toBe(true);

    s.key('Escape');

    expect(isOpen(s)).toBe(false);
    expect(document.activeElement).toBe(s.trigger);
    expect(parentSaw).toEqual(['Enter']); // el Escape no llegó al documento
    s.el.remove();
  });

  it('Escape con el menú cerrado no se intercepta (lo puede usar un diálogo)', () => {
    const s = setup();
    expect(s.key('Escape').defaultPrevented).toBe(false);
  });

  it('Enter, Espacio y flechas abren el menú; Enter/Espacio ya no disparan además el click', () => {
    for (const k of ['Enter', ' ', 'ArrowDown', 'ArrowUp']) {
      TestBed.resetTestingModule();
      const s = setup();
      const event = s.key(k);
      expect(isOpen(s)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('al abrir, la opción resaltada es la seleccionada o, si no hay, la primera', () => {
    const withSelection = setup({ selectedId: 3 });
    withSelection.key('Enter');
    expect(withSelection.trigger.getAttribute('aria-activedescendant')).toBe(withSelection.options()[2].id);

    TestBed.resetTestingModule();
    const none = setup();
    none.key('Enter');
    expect(none.trigger.getAttribute('aria-activedescendant')).toBe(none.options()[0].id);
    expect(none.options()[0].classList).toContain('dd__option--active');
  });

  it('ArrowDown / ArrowUp mueven la opción resaltada sin salirse de los extremos; Home y End saltan', () => {
    const s = setup({ selectedId: 2 });
    s.key('Enter');
    const active = () => s.options().findIndex((o) => o.id === s.trigger.getAttribute('aria-activedescendant'));

    s.key('ArrowDown');
    expect(active()).toBe(2);
    s.key('ArrowDown');
    s.key('ArrowDown');
    expect(active()).toBe(3);
    s.key('ArrowUp');
    expect(active()).toBe(2);
    s.key('Home');
    expect(active()).toBe(0);
    s.key('ArrowUp');
    expect(active()).toBe(0);
    s.key('End');
    expect(active()).toBe(3);
  });

  it('Enter selecciona la opción resaltada; Espacio también', () => {
    const s = setup();
    s.key('Enter');
    s.key('ArrowDown');
    s.key('Enter');
    expect(s.emitted).toEqual([SIZES[1]]);
    expect(isOpen(s)).toBe(false);

    s.key(' ');
    s.key('End');
    s.key(' ');
    expect(s.emitted).toEqual([SIZES[1], SIZES[3]]);
  });

  it('Tab cierra el menú sin impedir el avance natural del foco', () => {
    const s = setup();
    s.key('Enter');
    expect(s.key('Tab').defaultPrevented).toBe(false);
    expect(isOpen(s)).toBe(false);
  });

  it('deshabilitado: el botón no se puede activar y el menú no se abre', () => {
    const s = setup({ disabled: true });
    expect(s.trigger.disabled).toBe(true);
    s.key('Enter');
    s.key('ArrowDown');
    expect(isOpen(s)).toBe(false);
    s.fixture.componentInstance.toggle();
    s.fixture.detectChanges();
    expect(isOpen(s)).toBe(false);
  });

  it('sin opciones no se abre', () => {
    const s = setup({ items: [] });
    s.trigger.click();
    s.fixture.detectChanges();
    expect(isOpen(s)).toBe(false);
  });

  it('pinta el icono de la opción (con app-icon) en la lista y, si está seleccionada, en el botón', () => {
    const s = setup({ selectedId: 4 });
    expect(s.options()[3].querySelector('app-icon svg')).not.toBeNull();
    expect(s.options()[0].querySelector('app-icon svg')).toBeNull();
    expect(s.trigger.querySelectorAll('app-icon').length).toBe(2); // icono del item + chevron
  });

  it('el nombre accesible sale de ariaLabel y el flag active marca el botón', () => {
    const s = setup({ ariaLabel: 'Tamaño', active: true });
    expect(s.trigger.getAttribute('aria-label')).toBe('Tamaño');
    expect(s.panel.getAttribute('aria-label')).toBe('Tamaño');
    expect(s.trigger.classList).toContain('dd__trigger--active');
  });

  it('las etiquetas largas se truncan con puntos suspensivos en vez de desbordar', () => {
    const long = 'Comunidad de propietarios de la urbanización Los Pinos del Valle, fase tercera y cuarta';
    const s = setup({ items: [{ id: 'x', label: long }], selectedId: 'x' });
    expect(text(s.el.querySelector('.dd__value'))).toBe(long);
    expect(s.el.querySelector('.dd__value')).not.toBeNull();
    expect(s.options()[0].querySelector('.dd__option-text')?.textContent).toBe(long);
  });

  it('no deja listeners de documento: se instala al abrir, se quita al cerrar y al destruir', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const pointer = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'pointerdown').length;
    const s = setup();
    expect(pointer(add)).toBe(0);

    s.trigger.click();
    s.fixture.detectChanges();
    expect(pointer(add)).toBe(1);
    s.trigger.click();
    s.fixture.detectChanges();
    expect(pointer(remove)).toBe(1);

    s.trigger.click(); // se abre otra vez y se destruye con el menú abierto
    s.fixture.detectChanges();
    expect(pointer(add)).toBe(2);
    s.fixture.destroy();
    expect(pointer(remove)).toBe(2);

    add.mockRestore();
    remove.mockRestore();
  });
});
