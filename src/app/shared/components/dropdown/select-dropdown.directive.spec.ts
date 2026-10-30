import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SelectDropdownDirective } from './select-dropdown.directive';
import { SelectPanelComponent } from './select-panel.component';

@Component({
  standalone: true,
  imports: [FormsModule, SelectDropdownDirective],
  template: `
    <select id="p" aria-label="Prioridad" [ngModel]="value()" (ngModelChange)="value.set($event)" [disabled]="disabled()">
      <option value="">Todas las prioridades</option>
      <option value="URGENTE">Urgente</option>
      <option value="ALTA" disabled>Alta</option>
      <optgroup label="Resto">
        <option value="MEDIA">Media</option>
        <option value="BAJA">Baja</option>
      </optgroup>
    </select>
    <select id="multi" multiple><option>a</option></select>
  `,
})
class HostComponent {
  readonly value = signal('');
  readonly disabled = signal(false);
}

interface Setup {
  fixture: ComponentFixture<HostComponent>;
  host: HostComponent;
  select: HTMLSelectElement;
  panel: () => HTMLElement | null;
  options: () => HTMLElement[];
  key: (key: string) => KeyboardEvent;
  mousedown: (el?: Element) => MouseEvent;
}

async function setup(): Promise<Setup> {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const select = fixture.nativeElement.querySelector('#p') as HTMLSelectElement;
  const panel = () => document.body.querySelector<HTMLElement>('app-select-panel');
  const key = (k: string) => {
    const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    select.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  const mousedown = (el: Element = select) => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    el.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  return {
    fixture, host: fixture.componentInstance, select, panel, key, mousedown,
    options: () => Array.from(document.body.querySelectorAll<HTMLElement>('app-select-panel .dd__option')),
  };
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

describe('SelectDropdownDirective', () => {
  afterEach(() => document.body.querySelectorAll('app-select-panel').forEach((el) => el.remove()));

  it('al pulsar el campo abre la lista de Domora en vez del popup nativo', async () => {
    const s = await setup();
    const event = s.mousedown();
    expect(event.defaultPrevented).toBe(true);
    expect(s.panel()).not.toBeNull();
    expect(s.select.getAttribute('aria-expanded')).toBe('true');
    expect(s.select.classList).toContain('dd-select--open');
    expect(s.select.getAttribute('aria-controls')).toBe(s.panel()!.id);
  });

  it('lista las opciones, los grupos y marca la seleccionada con check', async () => {
    const s = await setup();
    s.mousedown();
    expect(s.options().map(text)).toEqual(['Todas las prioridades', 'Urgente', 'Alta', 'Media', 'Baja']);
    expect(text(s.panel()!.querySelector('.dd__group'))).toBe('Resto');
    expect(s.options()[0].getAttribute('aria-selected')).toBe('true');
    expect(s.options()[0].querySelector('.dd__check')).not.toBeNull();
    expect(s.panel()!.querySelectorAll('.dd__check').length).toBe(1);
    expect(s.options()[2].getAttribute('aria-disabled')).toBe('true');
  });

  it('elegir una opción actualiza el ngModel, dispara change y cierra la lista', async () => {
    const s = await setup();
    const changes: string[] = [];
    s.select.addEventListener('change', () => changes.push(s.select.value));
    s.mousedown();
    s.options()[1].click();
    s.fixture.detectChanges();
    expect(s.host.value()).toBe('URGENTE');
    expect(s.select.value).toBe('URGENTE');
    expect(changes).toEqual(['URGENTE']);
    expect(s.panel()).toBeNull();
    expect(s.select.getAttribute('aria-expanded')).toBe('false');
  });

  it('una opción deshabilitada no se puede elegir', async () => {
    const s = await setup();
    s.mousedown();
    s.options()[2].click();
    s.fixture.detectChanges();
    expect(s.host.value()).toBe('');
    expect(s.panel()).not.toBeNull();
  });

  it('elegir la opción ya seleccionada solo cierra, sin disparar change', async () => {
    const s = await setup();
    const changes: string[] = [];
    s.select.addEventListener('change', () => changes.push(s.select.value));
    s.mousedown();
    s.options()[0].click();
    expect(changes).toEqual([]);
    expect(s.panel()).toBeNull();
  });

  it('teclado: flechas abren y mueven saltando las deshabilitadas, Enter elige, Escape cierra sin cerrar al padre', async () => {
    const s = await setup();
    expect(s.key('ArrowDown').defaultPrevented).toBe(true);
    expect(s.panel()).not.toBeNull();
    s.key('ArrowDown'); // Urgente
    s.key('ArrowDown'); // salta "Alta" (deshabilitada) → Media
    expect(s.select.getAttribute('aria-activedescendant')).toBe(s.options()[3].id);
    s.key('Enter');
    expect(s.host.value()).toBe('MEDIA');
    expect(s.panel()).toBeNull();

    s.key(' ');
    expect(s.panel()).not.toBeNull();
    const esc = s.key('Escape');
    expect(esc.defaultPrevented).toBe(true);
    expect(s.panel()).toBeNull();
  });

  it('pasar el ratón por una opción la anuncia como activa (aria-activedescendant)', async () => {
    const s = await setup();
    s.mousedown();
    s.options()[3].dispatchEvent(new Event('mouseenter'));
    s.fixture.detectChanges();
    expect(s.select.getAttribute('aria-activedescendant')).toBe(s.options()[3].id);
    s.key('Enter');
    expect(s.host.value()).toBe('MEDIA');
    expect(s.select.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('Home y End saltan a la primera y última opción', async () => {
    const s = await setup();
    s.key('ArrowDown');
    s.key('End');
    expect(s.select.getAttribute('aria-activedescendant')).toBe(s.options()[4].id);
    s.key('Home');
    expect(s.select.getAttribute('aria-activedescendant')).toBe(s.options()[0].id);
  });

  it('escribir letras salta a la opción que empieza por ellas', async () => {
    const s = await setup();
    s.key('ArrowDown');
    s.key('b');
    expect(s.select.getAttribute('aria-activedescendant')).toBe(s.options()[4].id);
  });

  it('un clic fuera cierra la lista; un clic en el campo la alterna', async () => {
    const s = await setup();
    s.mousedown();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    s.fixture.detectChanges();
    expect(s.panel()).toBeNull();

    s.mousedown();
    expect(s.panel()).not.toBeNull();
    s.mousedown();
    expect(s.panel()).toBeNull();
  });

  function touch(s: Setup, type: 'touchstart' | 'touchend', x: number, y: number): Event {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const point = [{ clientX: x, clientY: y }];
    Object.defineProperty(event, type === 'touchstart' ? 'touches' : 'changedTouches', { value: point });
    s.select.dispatchEvent(event);
    s.fixture.detectChanges();
    return event;
  }

  it('móvil: un toque cancela el selector nativo y abre la lista sin enfocar el campo', async () => {
    const s = await setup();
    touch(s, 'touchstart', 10, 10);
    const end = touch(s, 'touchend', 12, 11);
    expect(end.defaultPrevented).toBe(true);
    expect(s.panel()).not.toBeNull();
    expect(document.activeElement).not.toBe(s.select);

    s.options()[1].click();
    s.fixture.detectChanges();
    expect(s.host.value()).toBe('URGENTE');
    expect(s.panel()).toBeNull();
    expect(document.activeElement).not.toBe(s.select);
  });

  it('móvil: deslizar el dedo sobre el campo es scroll y no abre nada', async () => {
    const s = await setup();
    touch(s, 'touchstart', 10, 10);
    const end = touch(s, 'touchend', 10, 80);
    expect(end.defaultPrevented).toBe(false);
    expect(s.panel()).toBeNull();
  });

  it('el scroll de la página recoloca la lista como mucho una vez por frame; el de la propia lista no', async () => {
    // Angular también usa requestAnimationFrame: se ejecutan todos los frames pendientes y se cuentan las recolocaciones.
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const runFrames = () => { const pending = frames; frames = []; pending.forEach((cb) => cb(0)); };
    const reposition = vi.spyOn(SelectPanelComponent.prototype, 'reposition');
    try {
      const s = await setup();
      s.mousedown();
      runFrames();
      reposition.mockClear();

      s.panel()!.dispatchEvent(new Event('scroll'));
      runFrames();
      expect(reposition).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('scroll'));
      document.body.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
      runFrames();
      expect(reposition).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new Event('scroll'));
      runFrames();
      expect(reposition).toHaveBeenCalledTimes(2);
    } finally {
      reposition.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('con el campo deshabilitado no abre nada', async () => {
    const s = await setup();
    s.host.disabled.set(true);
    s.fixture.detectChanges();
    await s.fixture.whenStable();
    s.mousedown();
    s.key('ArrowDown');
    expect(s.panel()).toBeNull();
  });

  it('refleja el valor que asigna el formulario al abrir de nuevo', async () => {
    const s = await setup();
    s.host.value.set('BAJA');
    s.fixture.detectChanges();
    await s.fixture.whenStable();
    s.mousedown();
    expect(s.options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'false', 'true']);
  });

  it('al destruir el componente con la lista abierta no deja nada en el body', async () => {
    const s = await setup();
    s.mousedown();
    s.fixture.destroy();
    expect(s.panel()).toBeNull();
  });

  it('no actúa sobre <select multiple>', async () => {
    const s = await setup();
    const multi = s.fixture.nativeElement.querySelector('#multi') as HTMLSelectElement;
    expect(multi.classList).not.toContain('dd-select');
    expect(s.select.classList).toContain('dd-select');
  });
});
