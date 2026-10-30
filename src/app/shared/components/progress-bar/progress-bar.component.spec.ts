import { TestBed } from '@angular/core/testing';
import { ProgressBarComponent } from './progress-bar.component';

describe('ProgressBarComponent', () => {
  function setup(inputs: Partial<Pick<ProgressBarComponent, 'value' | 'max' | 'height' | 'color'>> = {}) {
    TestBed.configureTestingModule({ imports: [ProgressBarComponent] });
    const fixture = TestBed.createComponent(ProgressBarComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return {
      fixture,
      track: fixture.nativeElement.querySelector('.progress-bar') as HTMLElement,
      fill: fixture.nativeElement.querySelector('.progress-bar__fill') as HTMLElement,
    };
  }

  it('con value/max normales, calcula el porcentaje correcto', () => {
    const { fill } = setup({ value: 25, max: 100 });
    expect(fill.style.width).toBe('25%');
  });

  it('value == max, llena al 100%', () => {
    const { fill } = setup({ value: 40, max: 40 });
    expect(fill.style.width).toBe('100%');
  });

  it('value > max, se acota a 100% en vez de desbordar', () => {
    const { fill } = setup({ value: 150, max: 100 });
    expect(fill.style.width).toBe('100%');
  });

  it('value negativo, se acota a 0% en vez de un ancho negativo', () => {
    const { fill } = setup({ value: -10, max: 100 });
    expect(fill.style.width).toBe('0%');
  });

  it('max = 0, da 0% en vez de NaN/Infinity por la división por cero', () => {
    const { fill } = setup({ value: 5, max: 0 });
    expect(fill.style.width).toBe('0%');
  });

  it('height controla la altura de la pista', () => {
    const { track } = setup({ height: 10 });
    expect(track.style.height).toBe('10px');
  });

  it('color custom se aplica al relleno', () => {
    const { fill } = setup({ value: 50, color: 'red' });
    expect(fill.style.background).toBe('red');
  });
});
