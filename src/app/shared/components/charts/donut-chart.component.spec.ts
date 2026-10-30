import { TestBed } from '@angular/core/testing';
import type { DonutSlice } from './chart-math';
import { DonutChartComponent } from './donut-chart.component';

const SLICES: DonutSlice[] = [
  { key: 'maint', label: 'Mantenimiento', value: 9_656 },
  { key: 'supplies', label: 'Suministros', value: 6_248 },
  { key: 'staff', label: 'Personal', value: 5_112 },
  { key: 'insurance', label: 'Seguros', value: 3_408 },
];
const euro = (v: number) => `${v.toLocaleString('es-ES')} €`;

describe('DonutChartComponent', () => {
  function setup(slices: DonutSlice[] = SLICES) {
    TestBed.configureTestingModule({ imports: [DonutChartComponent] });
    const fixture = TestBed.createComponent(DonutChartComponent);
    fixture.componentRef.setInput('slices', slices);
    fixture.componentRef.setInput('valueFormatter', euro);
    fixture.componentRef.setInput('caption', 'Distribución de gastos');
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('con showTotal=false el centro del anillo queda vacío y la leyenda sigue', () => {
    TestBed.configureTestingModule({ imports: [DonutChartComponent] });
    const fixture = TestBed.createComponent(DonutChartComponent);
    fixture.componentRef.setInput('slices', SLICES);
    fixture.componentRef.setInput('showTotal', false);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.donut__total')).toBeNull();
    expect(el.querySelector('.donut__caption')).toBeNull();
    expect(el.querySelectorAll('.donut__row')).toHaveLength(4);
  });

  it('una porción por categoría y el total en el centro', () => {
    const { el } = setup();
    expect(el.querySelectorAll('.donut__slice')).toHaveLength(4);
    expect(el.querySelector('.donut__total')?.textContent?.trim()).toBe(euro(24_424));
    expect(el.querySelector('.donut__caption')?.textContent?.trim()).toBe('Total');
  });

  it('la leyenda lleva etiqueta, porcentaje e importe (la identidad no depende del color)', () => {
    const { el } = setup();
    const first = el.querySelector('.donut__row')!;
    expect(first.querySelector('.donut__label')?.textContent?.trim()).toBe('Mantenimiento');
    expect(first.querySelector('.donut__percent')?.textContent?.trim()).toBe('40 %');
    expect(first.querySelector('.donut__amount')?.textContent?.trim()).toBe(euro(9_656));
  });

  it('los porcentajes suman el reparto: cada porción cubre su parte', () => {
    const { el } = setup();
    const percents = Array.from(el.querySelectorAll('.donut__percent')).map(p => parseFloat(p.textContent!.replace(',', '.')));
    expect(Math.round(percents.reduce((a, b) => a + b, 0))).toBeGreaterThanOrEqual(99);
    expect(Math.round(percents.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(101);
  });

  it('con más de seis partes pliega la cola en "Otros" con el tono neutro', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, label: `Cat ${i}`, value: 100 - i }));
    const { el } = setup(many);
    const labels = Array.from(el.querySelectorAll('.donut__label')).map(l => l.textContent?.trim());
    expect(labels).toHaveLength(6);
    expect(labels[5]).toBe('Otros');
    expect(el.querySelectorAll<SVGPathElement>('.donut__slice')[5].style.fill).toBe('var(--color-muted)');
  });

  it('el color sigue a la entidad (slot) y no al ranking', () => {
    const { el } = setup([{ key: 'a', label: 'A', value: 1, slot: 4 }, { key: 'b', label: 'B', value: 5, slot: 2 }]);
    const fills = Array.from(el.querySelectorAll<SVGPathElement>('.donut__slice')).map(p => p.style.fill);
    expect(fills).toEqual(['var(--chart-4)', 'var(--chart-2)']);
  });

  it('enfocar una porción resalta su fila de leyenda y atenúa el resto', () => {
    const { fixture, el } = setup();
    el.querySelectorAll<SVGPathElement>('.donut__slice')[1].dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(el.querySelector('.donut')?.classList.contains('donut--hovering')).toBe(true);
    expect(el.querySelectorAll('.donut__row')[1].classList.contains('donut__row--active')).toBe(true);
    expect(el.querySelectorAll('.donut__row')[0].classList.contains('donut__row--active')).toBe(false);
  });

  it('cada porción es alcanzable por teclado y describe su valor', () => {
    const { el } = setup();
    const slice = el.querySelector('.donut__slice')!;
    expect(slice.getAttribute('tabindex')).toBe('0');
    expect(slice.getAttribute('aria-label')).toBe(`Mantenimiento: ${euro(9_656)} (40 %)`);
  });

  it('una sola categoría dibuja el anillo completo sin huecos', () => {
    const { el } = setup([{ key: 'a', label: 'A', value: 10 }]);
    const d = el.querySelector('.donut__slice')!.getAttribute('d')!;
    expect((d.match(/M/g) ?? []).length).toBe(2);
    expect(el.querySelector('.donut__percent')?.textContent?.trim()).toBe('100 %');
  });

  it('la vista de tabla lista importes y porcentajes', () => {
    const { fixture, el } = setup();
    (el.querySelector('.chart__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('svg')).toBeNull();
    expect(Array.from(el.querySelectorAll('tbody tr:first-child td')).map(td => td.textContent?.trim())).toEqual([euro(9_656), '40 %']);
  });

  it('sin importes positivos muestra el estado vacío', () => {
    const { el } = setup([{ key: 'a', label: 'A', value: 0 }]);
    expect(el.querySelector('.chart__empty')).not.toBeNull();
    expect(el.querySelector('svg')).toBeNull();
  });
});
