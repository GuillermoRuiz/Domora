import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FocusTrapDirective } from './focus-trap.directive';

@Component({
  standalone: true,
  imports: [FocusTrapDirective],
  template: `
    <button id="opener" type="button">Abrir</button>
    @if (open()) {
      <div id="dialog" appFocusTrap>
        <button id="first" type="button">Primero</button>
        <input id="auto" data-autofocus />
        <button id="disabled" type="button" disabled>Inactivo</button>
        <button id="last" type="button">Último</button>
      </div>
    }
  `,
})
class HostComponent {
  readonly open = signal(false);
}

function tab(el: Element, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

describe('FocusTrapDirective', () => {
  async function setup() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const q = (id: string) => fixture.nativeElement.querySelector(`#${id}`) as HTMLElement;
    q('opener').focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    return { fixture, q };
  }

  it('al abrirse, el foco entra en el control marcado como data-autofocus', async () => {
    const { q } = await setup();
    expect(document.activeElement).toBe(q('auto'));
  });

  it('Tab en el último control vuelve al primero y Shift+Tab en el primero salta al último (ignora los deshabilitados)', async () => {
    const { q } = await setup();

    q('last').focus();
    const forward = tab(q('last'));
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q('first'));

    const backward = tab(q('first'), true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q('last'));
  });

  it('un Tab en medio del diálogo sigue el orden natural del navegador (no se intercepta)', async () => {
    const { q } = await setup();
    q('first').focus();

    expect(tab(q('first')).defaultPrevented).toBe(false);
  });

  it('al cerrarse, el foco vuelve al elemento que lo abrió', async () => {
    const { fixture, q } = await setup();

    fixture.componentInstance.open.set(false);
    fixture.detectChanges();

    expect(document.activeElement).toBe(q('opener'));
  });
});
