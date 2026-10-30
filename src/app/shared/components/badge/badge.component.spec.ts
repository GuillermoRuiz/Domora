import { TestBed } from '@angular/core/testing';
import { BadgeComponent } from './badge.component';

describe('BadgeComponent', () => {
  function setup(inputs: Partial<Pick<BadgeComponent, 'text' | 'variant'>> = {}) {
    TestBed.configureTestingModule({ imports: [BadgeComponent] });
    const fixture = TestBed.createComponent(BadgeComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return { fixture, span: fixture.nativeElement.querySelector('.badge') as HTMLElement };
  }

  it('muestra el texto tal cual', () => {
    const { span } = setup({ text: 'Activa' });
    expect(span.textContent?.trim()).toBe('Activa');
  });

  it('acepta un número como texto (no solo string)', () => {
    const { span } = setup({ text: 3 });
    expect(span.textContent?.trim()).toBe('3');
  });

  it('sin variante, usa "default"', () => {
    const { span } = setup({ text: 'x' });
    expect(span.className).toContain('badge--default');
  });

  it('aplica la clase de la variante pedida', () => {
    const { span } = setup({ text: 'x', variant: 'error' });
    expect(span.className).toContain('badge--error');
    expect(span.className).not.toContain('badge--default');
  });
});
