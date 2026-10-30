import { TestBed } from '@angular/core/testing';
import { LineChartComponent } from './line-chart.component';

const MONTHS = ['Ene', 'Feb', 'Mar'];
const euro = (v: number) => `${v.toLocaleString('es-ES')} €`;

describe('LineChartComponent', () => {
  function setup(values: number[] = [0, 100, 50], area = false) {
    TestBed.configureTestingModule({ imports: [LineChartComponent] });
    const fixture = TestBed.createComponent(LineChartComponent);
    fixture.componentRef.setInput('categories', MONTHS);
    fixture.componentRef.setInput('values', values);
    fixture.componentRef.setInput('label', 'MRR');
    fixture.componentRef.setInput('area', area);
    fixture.componentRef.setInput('height', 200);
    fixture.componentRef.setInput('valueFormatter', euro);
    fixture.componentRef.setInput('caption', 'Evolución del MRR');
    fixture.componentInstance.width.set(300);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('dibuja la línea por el centro de cada mes con la escala redonda desde 0', () => {
    const { el } = setup();
    expect(el.querySelector('.chart__line')?.getAttribute('d')).toBe('M87,170 L169,10 L251,90');
    expect(Array.from(el.querySelectorAll('.chart__xlabel')).map(t => t.textContent?.trim())).toEqual(MONTHS);
    expect(el.querySelector('.chart__area')).toBeNull();
  });

  it('en modo área rellena bajo la línea hasta la base', () => {
    const { el } = setup([0, 100, 50], true);
    expect(el.querySelector('.chart__area')?.getAttribute('d')).toBe('M87,170 L169,10 L251,90 L251,170 L87,170 Z');
  });

  it('al enfocar un mes con el teclado muestra el tooltip con su valor, la guía vertical y el punto', () => {
    const { fixture, el } = setup();
    const hits = el.querySelectorAll<SVGRectElement>('.chart__hit');
    expect(hits).toHaveLength(3);
    hits[1].dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.querySelector('.chart__tooltip-title')?.textContent?.trim()).toBe('Feb');
    expect(el.querySelector('.chart__tooltip-value')?.textContent?.trim()).toBe('100 €');
    expect(el.querySelector('.chart__crosshair')?.getAttribute('x1')).toBe('169');
    expect(el.querySelector('.chart__marker')?.getAttribute('cy')).toBe('10');
    hits[1].dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(el.querySelector('.chart__tooltip')).toBeNull();
  });

  it('al pasar el puntero por un mes también muestra su tooltip', () => {
    const { fixture, el } = setup();
    el.querySelectorAll('.chart__hit')[2].dispatchEvent(new Event('pointermove'));
    fixture.detectChanges();
    expect(el.querySelector('.chart__tooltip-title')?.textContent?.trim()).toBe('Mar');
  });

  it('«Ver como tabla» cambia el gráfico por una tabla equivalente y vuelve con «Ver gráfico»', () => {
    const { fixture, el } = setup();
    const toggle = el.querySelector<HTMLButtonElement>('.chart__toggle')!;
    expect(toggle.textContent?.trim()).toBe('Ver como tabla');
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('svg')).toBeNull();
    const rows = Array.from(el.querySelectorAll('.chart__table tbody tr')).map(r => Array.from(r.children).map(c => c.textContent?.trim()).join(' '));
    expect(rows).toEqual(['Ene 0 €', 'Feb 100 €', 'Mar 50 €']);
    expect(el.querySelector('.chart__table th[scope=col]:last-child')?.textContent?.trim()).toBe('MRR');
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('.chart__line')).not.toBeNull();
  });

  it('sin ningún valor distinto de cero muestra el texto vacío en vez de una línea plana', () => {
    const { el } = setup([0, 0, 0]);
    expect(el.querySelector('.chart__empty')?.textContent?.trim()).toBe('Sin datos para este periodo');
    expect(el.querySelector('svg')).toBeNull();
  });
});
