import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { BtnComponent } from './btn.component';

/**
 * Piloto "tonto": sin servicios de datos/AuthService de por medio, solo
 * @Input/@Output. Sirve para validar el patrón de render real en este
 * proyecto (zoneless, Vitest + jsdom) antes de tocar componentes con
 * lógica de negocio.
 *
 * Se envuelve en un host de prueba en vez de testear BtnComponent
 * directamente: así se puede proyectar contenido real por <ng-content>
 * y comprobar el (click) tal como lo usaría cualquier pantalla.
 */
@Component({
  standalone: true,
  imports: [BtnComponent],
  template: `
    <app-btn
      [variant]="variant"
      [size]="size"
      [disabled]="disabled"
      [type]="type"
      (clicked)="onClicked($event)"
    >Guardar</app-btn>
  `,
})
class HostComponent {
  variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' = 'primary';
  size: 'sm' | 'lg' | 'icon' | '' = '';
  disabled = false;
  type: 'button' | 'submit' | 'reset' = 'button';
  clickCount = 0;
  lastEvent: MouseEvent | null = null;

  onClicked(event: MouseEvent): void {
    this.clickCount++;
    this.lastEvent = event;
  }
}

/**
 * Ojo zoneless: mutar un campo del host y volver a llamar a
 * `detectChanges()` en la MISMA instancia dispara NG0100
 * (ExpressionChangedAfterItHasBeenCheckedError) — el chequeo de "sin
 * cambios" de la pasada anterior no admite una mutación fuera de un signal
 * entre medio. Cada escenario se arma con una fixture nueva, con los
 * valores ya puestos ANTES del primer (y único) detectChanges().
 */
describe('BtnComponent', () => {
  function setup(overrides: Partial<Pick<HostComponent, 'variant' | 'size' | 'disabled' | 'type'>> = {}) {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    Object.assign(fixture.componentInstance, overrides);
    fixture.detectChanges();
    const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    return { fixture, host: fixture.componentInstance, button };
  }

  it('proyecta el contenido y aplica la clase de variante/tamaño', () => {
    const { button } = setup({ variant: 'danger', size: 'lg' });

    expect(button().textContent?.trim()).toBe('Guardar');
    expect(button().className).toContain('btn--danger');
    expect(button().className).toContain('btn--lg');
  });

  it('sin size explícito, no añade un modificador vacío ("btn-- ")', () => {
    const { button } = setup();
    expect(button().className).not.toMatch(/btn--\s*$/);
  });

  it('el click real dispara clicked con el MouseEvent', () => {
    const { fixture, host, button } = setup();
    button().click();
    fixture.detectChanges();

    expect(host.clickCount).toBe(1);
    expect(host.lastEvent).toBeInstanceOf(MouseEvent);
  });

  it('disabled deshabilita el <button> nativo y el navegador bloquea el click — clicked no se emite', () => {
    const { fixture, host, button } = setup({ disabled: true });

    expect(button().disabled).toBe(true);
    button().click();
    fixture.detectChanges();
    expect(host.clickCount).toBe(0);
  });

  it('type por defecto es "button" — nunca dispara un submit sin querer', () => {
    const { button } = setup();
    expect(button().type).toBe('button');
  });

  it('type se refleja en el atributo type del <button> cuando se pide explícito', () => {
    const { button } = setup({ type: 'submit' });
    expect(button().type).toBe('submit');
  });
});
