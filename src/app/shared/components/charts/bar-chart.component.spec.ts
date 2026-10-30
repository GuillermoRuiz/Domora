import { TestBed } from '@angular/core/testing';
import { BarChartComponent, type BarSeries } from './bar-chart.component';

const MONTHS = ['Ene', 'Feb', 'Mar'];
const SERIES: BarSeries[] = [
  { key: 'income', label: 'Ingresos', values: [12_000, 14_500, 0] },
  { key: 'expenses', label: 'Gastos', values: [8_000, 9_000, 7_500] },
];
const euro = (v: number) => `${v.toLocaleString('es-ES')} €`;

describe('BarChartComponent', () => {
  function setup(series: BarSeries[] = SERIES, categories: string[] = MONTHS) {
    TestBed.configureTestingModule({ imports: [BarChartComponent] });
    const fixture = TestBed.createComponent(BarChartComponent);
    fixture.componentRef.setInput('categories', categories);
    fixture.componentRef.setInput('series', series);
    fixture.componentRef.setInput('valueFormatter', euro);
    fixture.componentRef.setInput('caption', 'Ingresos y gastos por mes');
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('pinta una barra por serie y categoría con valor, un eje con ticks redondos y la etiqueta de cada categoría', () => {
    const { el } = setup();
    // 3 meses × 2 series, salvo la barra de valor 0 (no se dibuja)
    expect(el.querySelectorAll('.chart__bar:not([d=""])').length).toBe(5);
    expect(Array.from(el.querySelectorAll('.chart__xlabel')).map(t => t.textContent?.trim())).toEqual(MONTHS);
    expect(el.querySelectorAll('.chart__tick').length).toBeGreaterThanOrEqual(3);
    expect(el.querySelector('.chart__tick')?.textContent?.trim()).toBe('0');
  });

  it('con integerTicks un recuento de máximo 1 tiene ticks 0 y 1, sin repetir «1»; sin la opción la escala es la de siempre', () => {
    TestBed.configureTestingModule({ imports: [BarChartComponent] });
    const fixture = TestBed.createComponent(BarChartComponent);
    fixture.componentRef.setInput('categories', MONTHS);
    fixture.componentRef.setInput('series', [{ key: 'a', label: 'A', values: [1, 0, 1] }]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const labels = () => Array.from(el.querySelectorAll('.chart__tick')).map(t => t.textContent?.trim());
    expect(labels()).toHaveLength(3); // 0 · 0,5 · 1 (default, unchanged)

    fixture.componentRef.setInput('integerTicks', true);
    fixture.detectChanges();
    expect(labels()).toEqual(['0', '1']);
  });

  it('en anchos estrechos salta etiquetas del eje X en vez de solaparlas, y el tooltip conserva todas', () => {
    const months = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
    TestBed.configureTestingModule({ imports: [BarChartComponent] });
    const fixture = TestBed.createComponent(BarChartComponent);
    fixture.componentRef.setInput('categories', months);
    fixture.componentRef.setInput('series', [{ key: 'a', label: 'A', values: months.map((_, i) => i + 1) }]);
    fixture.componentInstance.width.set(300);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.chart__xlabel').length).toBeLessThan(12);
    expect(el.querySelectorAll('.chart__hit')).toHaveLength(12);
  });

  it('la leyenda aparece con 2+ series y no con una sola', () => {
    const two = setup();
    expect(Array.from(two.el.querySelectorAll('.chart__legend-item')).map(li => li.textContent?.trim())).toEqual(['Ingresos', 'Gastos']);

    TestBed.resetTestingModule();
    const one = setup([SERIES[0]]);
    expect(one.el.querySelector('.chart__legend')).toBeNull();
  });

  it('el color sigue a la entidad (slot), no a la posición', () => {
    const { el } = setup([{ ...SERIES[0], slot: 3 }, { ...SERIES[1], slot: 2 }]);
    const fills = Array.from(el.querySelectorAll<SVGPathElement>('.chart__bar')).map(p => p.style.fill);
    expect(fills).toContain('var(--chart-3)');
    expect(fills).toContain('var(--chart-2)');
    expect(fills).not.toContain('var(--chart-1)');
  });

  it('las barras son finas: nunca más de 24 px de ancho', () => {
    const { el } = setup([{ key: 'a', label: 'A', values: [5] }], ['Solo']);
    const d = el.querySelector('.chart__bar')!.getAttribute('d')!;
    const [, x0] = /^M([\d.]+),/.exec(d)!.map(Number);
    const xEnd = Number(/H([\d.]+) Q/.exec(d)![1]);
    expect(xEnd + 4 - x0).toBeLessThanOrEqual(24); // H termina 4px antes del borde por el radio
  });

  it('al enfocar una categoría muestra el tooltip con todos los valores, el valor primero', () => {
    const { fixture, el } = setup();
    const hit = el.querySelectorAll<SVGRectElement>('.chart__hit')[1];
    hit.dispatchEvent(new Event('focus'));
    fixture.detectChanges();

    const tip = el.querySelector('.chart__tooltip')!;
    expect(tip.querySelector('.chart__tooltip-title')?.textContent?.trim()).toBe('Feb');
    const rows = Array.from(tip.querySelectorAll('.chart__tooltip-row')).map(r => r.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('Ingresos');
    expect(rows[0]!.indexOf('14.500')).toBeLessThan(rows[0]!.indexOf('Ingresos'));
    expect(rows).toHaveLength(2);

    hit.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(el.querySelector('.chart__tooltip')).toBeNull();
  });

  it('cada categoría es alcanzable por teclado y describe sus valores', () => {
    const { el } = setup();
    const hit = el.querySelector('.chart__hit')!;
    expect(hit.getAttribute('tabindex')).toBe('0');
    expect(hit.getAttribute('aria-label')).toBe('Ene: Ingresos 12.000 €, Gastos 8000 €');
  });

  it('la vista de tabla ofrece los mismos valores sin pasar por el tooltip', () => {
    const { fixture, el } = setup();
    (el.querySelector('.chart__toggle') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('caption')?.textContent).toContain('Ingresos y gastos por mes');
    expect(Array.from(el.querySelectorAll('tbody tr:nth-child(2) td')).map(td => td.textContent?.trim())).toEqual(['14.500 €', '9000 €']);
    expect((el.querySelector('.chart__toggle') as HTMLElement).textContent).toContain('Ver gráfico');
  });

  it('sin datos muestra el texto de estado vacío y ninguna barra', () => {
    const { el } = setup([{ key: 'a', label: 'A', values: [0, 0, 0] }]);
    expect(el.querySelector('.chart__empty')?.textContent).toContain('Sin datos');
    expect(el.querySelector('svg')).toBeNull();
  });
});
