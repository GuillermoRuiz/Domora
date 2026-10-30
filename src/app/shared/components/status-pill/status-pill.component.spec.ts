import { TestBed } from '@angular/core/testing';
import { StatusPillComponent } from './status-pill.component';

describe('StatusPillComponent', () => {
  function setup(inputs: Partial<Pick<StatusPillComponent, 'text' | 'tone' | 'dot'>>) {
    TestBed.configureTestingModule({ imports: [StatusPillComponent] });
    const fixture = TestBed.createComponent(StatusPillComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('muestra el texto y usa el tono neutro por defecto', () => {
    const el = setup({ text: 'Programado' });
    expect(el.querySelector('.pill')?.textContent?.trim()).toBe('Programado');
    expect(el.querySelector('.pill')?.classList.contains('pill--neutral')).toBe(true);
  });

  it('aplica el tono pedido', () => {
    const el = setup({ text: 'Con incidencias', tone: 'danger' });
    expect(el.querySelector('.pill')?.classList.contains('pill--danger')).toBe(true);
  });

  it('el punto solo aparece si se pide, y es decorativo', () => {
    expect(setup({ text: 'Al día', tone: 'positive' }).querySelector('.pill__dot')).toBeNull();
    TestBed.resetTestingModule();
    const dot = setup({ text: 'Al día', tone: 'positive', dot: true }).querySelector('.pill__dot');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });
});
