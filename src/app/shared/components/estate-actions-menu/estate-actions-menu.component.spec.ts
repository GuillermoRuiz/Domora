import { TestBed } from '@angular/core/testing';
import { EstateActionsMenuComponent } from './estate-actions-menu.component';

describe('EstateActionsMenuComponent', () => {
  function setup(opts: { variant?: 'button' | 'icon'; remaining?: number | null; name?: string } = {}) {
    TestBed.configureTestingModule({ imports: [EstateActionsMenuComponent] });
    const fixture = TestBed.createComponent(EstateActionsMenuComponent);
    fixture.componentRef.setInput('estateId', 'e1');
    fixture.componentRef.setInput('estateName', opts.name ?? 'Residencial Plaza');
    fixture.componentRef.setInput('variant', opts.variant ?? 'button');
    fixture.componentRef.setInput('setupRemaining', opts.remaining ?? null);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const trigger = () => el.querySelector('.trigger') as HTMLButtonElement;
    const items = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const labels = () => items().map((b) => b.querySelector('.item__label')?.textContent?.trim());
    /** Deja pasar el render del panel y el foco posterior (`afterNextRender`). */
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const key = (target: Element, k: string) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    };
    return { fixture, cmp: fixture.componentInstance, el, trigger, items, labels, settle, key };
  }

  const originalWidth = window.innerWidth;
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  });

  it('variante «Acciones»: botón con etiqueta, sin menú hasta pulsarlo y con los atributos ARIA del patrón', () => {
    const { el, trigger } = setup();
    expect(trigger().textContent).toContain('Acciones');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('variante «⋯»: nombre accesible con la finca y los pasos pendientes (singular y plural)', () => {
    const none = setup({ variant: 'icon' });
    expect(none.trigger().getAttribute('aria-label')).toBe('Acciones de Residencial Plaza');
    expect(none.el.querySelector('.trigger__dot')).toBeNull();

    TestBed.resetTestingModule();
    const one = setup({ variant: 'icon', remaining: 1 });
    expect(one.trigger().getAttribute('aria-label')).toBe('Acciones de Residencial Plaza, 1 paso pendiente');
    expect(one.el.querySelector('.trigger__dot')).not.toBeNull();

    TestBed.resetTestingModule();
    const three = setup({ variant: 'icon', remaining: 3 });
    expect(three.trigger().getAttribute('aria-label')).toBe('Acciones de Residencial Plaza, 3 pasos pendientes');
  });

  it('al pulsar abre el menú: aria-expanded, orden de las acciones y foco en la primera', async () => {
    const { el, trigger, labels, items, settle } = setup({ remaining: 2 });
    trigger().click();
    await settle();

    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[role="menu"]')).not.toBeNull();
    expect(trigger().getAttribute('aria-controls')).toBe(el.querySelector('[role="menu"]')?.id);
    expect(labels()).toEqual(['Puesta en marcha', 'Editar finca', 'Historial de cargos', 'Importar del Catastro', 'Nueva propiedad']);
    expect(document.activeElement).toBe(items()[0]);
    expect(el.querySelector('[role="separator"]')).not.toBeNull();
  });

  it('sin pasos pendientes no ofrece «Puesta en marcha»', async () => {
    const { trigger, labels, settle } = setup({ remaining: 0 });
    trigger().click();
    await settle();
    expect(labels()).toEqual(['Editar finca', 'Historial de cargos', 'Importar del Catastro', 'Nueva propiedad']);
  });

  it('«Puesta en marcha» anuncia el número de pasos que faltan', async () => {
    const { trigger, items, settle } = setup({ remaining: 3 });
    trigger().click();
    await settle();
    expect(items()[0].getAttribute('aria-label')).toBe('Puesta en marcha, 3 pasos pendientes');
  });

  it('cada opción emite su evento, cierra el menú y devuelve el foco al botón', async () => {
    const { cmp, trigger, items, settle, el } = setup({ remaining: 2 });
    const calls: string[] = [];
    cmp.openSetup.subscribe(() => calls.push('setup'));
    cmp.edit.subscribe(() => calls.push('edit'));
    cmp.officeHistory.subscribe(() => calls.push('history'));
    cmp.importCatastro.subscribe(() => calls.push('import'));
    cmp.newProperty.subscribe(() => calls.push('new'));

    for (const index of [0, 1, 2, 3, 4]) {
      trigger().click();
      await settle();
      items()[index].click();
      await settle();
      expect(el.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger());
    }
    expect(calls).toEqual(['setup', 'edit', 'history', 'import', 'new']);
  });

  it('teclado en el botón: flecha abajo abre y enfoca la primera; flecha arriba, la última', async () => {
    const down = setup();
    down.key(down.trigger(), 'ArrowDown');
    await down.settle();
    expect(document.activeElement).toBe(down.items()[0]);

    TestBed.resetTestingModule();
    const up = setup();
    up.key(up.trigger(), 'ArrowUp');
    await up.settle();
    const items = up.items();
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('teclado en el menú: flechas con vuelta, Inicio y Fin', async () => {
    const { trigger, items, settle, key } = setup({ remaining: 1 });
    trigger().click();
    await settle();
    const list = items();

    const last = list[list.length - 1];
    key(list[0], 'ArrowUp');
    expect(document.activeElement).toBe(last);
    key(last, 'ArrowDown');
    expect(document.activeElement).toBe(list[0]);
    key(list[0], 'End');
    expect(document.activeElement).toBe(last);
    key(last, 'Home');
    expect(document.activeElement).toBe(list[0]);
  });

  it('Escape cierra el menú y devuelve el foco al botón; Tab lo cierra sin atrapar el foco', async () => {
    const { el, trigger, items, settle, key } = setup();
    trigger().click();
    await settle();
    key(items()[0], 'Escape');
    await settle();
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());

    trigger().click();
    await settle();
    key(items()[0], 'Tab');
    await settle();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('un clic fuera lo cierra, pero un clic dentro del panel no', async () => {
    const { el, trigger, settle } = setup();
    trigger().click();
    await settle();
    (el.querySelector('.menu__separator, .menu') as HTMLElement).click();
    await settle();
    expect(el.querySelector('[role="menu"]')).not.toBeNull();

    document.body.click();
    await settle();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('el clic en el botón no se propaga (el botón puede estar dentro de un enlace o una tarjeta)', () => {
    const { el, trigger } = setup();
    const onClick = vi.fn();
    el.addEventListener('click', onClick);
    trigger().click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('en móvil el menú es una hoja inferior con título y fondo que lo cierra al tocar', async () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true }) });
    const { el, trigger, settle } = setup({ name: 'Calle Colón 24' });
    trigger().click();
    await settle();

    expect(el.querySelector('.panel--sheet')).not.toBeNull();
    expect(el.querySelector('.panel__title')?.textContent).toContain('Acciones de Calle Colón 24');
    (el.querySelector('.backdrop') as HTMLElement).click();
    await settle();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('un scroll con el botón a la vista no cierra el menú; con el botón fuera de la vista, sí', async () => {
    const { el, trigger, settle, cmp } = setup();
    trigger().click();
    await settle();

    const rect = (top: number) => ({ top, bottom: top + 40, left: 100, right: 140, width: 40, height: 40, x: 100, y: top, toJSON: () => ({}) }) as DOMRect;
    const spy = vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue(rect(120));
    document.dispatchEvent(new Event('scroll'));
    expect(cmp.isOpen()).toBe(true);
    expect(cmp.position().top).toBeGreaterThan(120);

    spy.mockReturnValue(rect(-200));
    document.dispatchEvent(new Event('scroll'));
    await settle();
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('al cambiar el ancho de la ventana se cierra; un cambio solo de alto (teclado virtual) no', async () => {
    const { el, trigger, settle, cmp } = setup();
    trigger().click();
    await settle();

    cmp.onResize();
    expect(cmp.isOpen()).toBe(true);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: window.innerWidth + 100 });
    cmp.onResize();
    await settle();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });
});
