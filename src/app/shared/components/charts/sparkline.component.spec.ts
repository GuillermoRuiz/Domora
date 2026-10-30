import { TestBed } from '@angular/core/testing';
import { SparklineComponent } from './sparkline.component';

describe('SparklineComponent', () => {
  function setup(values: number[]) {
    TestBed.configureTestingModule({ imports: [SparklineComponent] });
    const fixture = TestBed.createComponent(SparklineComponent);
    fixture.componentRef.setInput('values', values);
    fixture.componentRef.setInput('width', 90);
    fixture.componentRef.setInput('height', 30);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('escala los valores entre su mínimo y su máximo dentro del alto, de izquierda a derecha', () => {
    const el = setup([1, 3, 2]);
    expect(el.querySelector('.sparkline__line')?.getAttribute('d')).toBe('M2,28 L45,2 L88,15');
  });

  it('una serie plana se dibuja como una línea horizontal a media altura', () => {
    const el = setup([5, 5]);
    expect(el.querySelector('.sparkline__line')?.getAttribute('d')).toBe('M2,15 L88,15');
  });

  it('con menos de dos valores no hay tendencia que dibujar', () => {
    expect(setup([7]).querySelector('svg')).toBeNull();
  });

  it('es decorativa: la cifra y la variación ya dan la información', () => {
    expect(setup([1, 2]).querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
