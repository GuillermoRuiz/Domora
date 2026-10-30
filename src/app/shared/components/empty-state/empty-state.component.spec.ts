import { TestBed } from '@angular/core/testing';
import { EmptyStateComponent } from './empty-state.component';

describe('EmptyStateComponent', () => {
  function setup(inputs: Partial<Pick<EmptyStateComponent, 'icon' | 'title' | 'description'>> = {}) {
    TestBed.configureTestingModule({ imports: [EmptyStateComponent] });
    const fixture = TestBed.createComponent(EmptyStateComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('sin inputs, usa el título por defecto ("Sin resultados") y no pinta descripción', () => {
    const { el } = setup();
    expect(el.querySelector('.empty-state__title')?.textContent?.trim()).toBe('Sin resultados');
    expect(el.querySelector('.empty-state__desc')).toBeNull();
  });

  it('con título y descripción propios, los muestra', () => {
    const { el } = setup({ title: 'Todavía no hay recibos', description: 'Genera el primero desde "Nuevo recibo".' });
    expect(el.querySelector('.empty-state__title')?.textContent?.trim()).toBe('Todavía no hay recibos');
    expect(el.querySelector('.empty-state__desc')?.textContent?.trim()).toBe('Genera el primero desde "Nuevo recibo".');
  });

  it('pasa el icon al app-icon interno', () => {
    const { el } = setup({ icon: 'receipt' });
    // IconComponent no expone el nombre como atributo DOM — se confirma
    // indirectamente comprobando que renderiza un <svg> (no rompe con un
    // nombre válido) dentro del contenedor de icono.
    expect(el.querySelector('.empty-state__icon svg')).not.toBeNull();
  });
});
