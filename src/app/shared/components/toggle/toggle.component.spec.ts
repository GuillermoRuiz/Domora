import { TestBed } from '@angular/core/testing';
import { ToggleComponent } from './toggle.component';

describe('ToggleComponent', () => {
  function setup(on = false) {
    TestBed.configureTestingModule({ imports: [ToggleComponent] });
    const fixture = TestBed.createComponent(ToggleComponent);
    fixture.componentInstance.on = on;
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.toggle') as HTMLButtonElement;
    return { fixture, button };
  }

  it('apagado, no tiene la clase toggle--on', () => {
    const { button } = setup(false);
    expect(button.className).not.toContain('toggle--on');
  });

  it('encendido, tiene la clase toggle--on', () => {
    const { button } = setup(true);
    expect(button.className).toContain('toggle--on');
  });

  it('el click emite el valor contrario al actual — apagado a encendido', () => {
    const { fixture, button } = setup(false);
    const emitted: boolean[] = [];
    fixture.componentInstance.onChange.subscribe((v) => emitted.push(v));

    button.click();

    expect(emitted).toEqual([true]);
  });

  it('el click emite el valor contrario al actual — encendido a apagado', () => {
    const { fixture, button } = setup(true);
    const emitted: boolean[] = [];
    fixture.componentInstance.onChange.subscribe((v) => emitted.push(v));

    button.click();

    expect(emitted).toEqual([false]);
  });

  it('es un <button type="button"> — nunca dispara un submit si vive dentro de un formulario', () => {
    const { button } = setup();
    expect(button.type).toBe('button');
  });

  it('es un interruptor accesible y, en versión «elegir», marca la variante', () => {
    const { button } = setup(true);
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.className).not.toContain('toggle--choice');
    const choice = TestBed.createComponent(ToggleComponent);
    choice.componentInstance.variant = 'choice';
    choice.componentInstance.label = 'Segunda convocatoria';
    choice.detectChanges();
    const choiceButton = choice.nativeElement.querySelector('.toggle') as HTMLButtonElement;
    expect(choiceButton.className).toContain('toggle--choice');
    expect(choiceButton.getAttribute('aria-label')).toBe('Segunda convocatoria');
  });
});
