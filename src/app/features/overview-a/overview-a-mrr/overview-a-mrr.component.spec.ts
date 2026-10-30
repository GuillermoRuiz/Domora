import { TestBed } from '@angular/core/testing';
import type { MrrMonth, MrrOverview } from '../../../core/platform-metrics.service';
import { LineChartComponent } from '../../../shared/components/charts/line-chart.component';
import { BarChartComponent } from '../../../shared/components/charts/bar-chart.component';
import { OverviewAMrrComponent } from './overview-a-mrr.component';
import { OverviewASignupsComponent } from './overview-a-signups.component';
import { By } from '@angular/platform-browser';

const month = (m: string, mrr: number, mv: Partial<MrrMonth['movements']> = {}): MrrMonth => ({
  month: m,
  mrr,
  payingClients: 1,
  movements: { new: 0, expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 0, signups: 0, cancellations: 0, ...mv },
});

const DATA: MrrOverview = {
  currentMrr: 1300,
  payingClients: 3,
  dataSince: '2026-08',
  months: [
    month('2026-07', 0),
    month('2026-08', 1000, { new: 1000, signups: 2 }),
    month('2026-09', 1200, { new: 300, churn: 100, signups: 1, cancellations: 1 }),
    month('2026-10', 1300, { expansion: 100 }),
  ],
};

function setup<T>(type: new (...args: any[]) => T, inputs: Record<string, unknown>) {
  TestBed.configureTestingModule({ imports: [type] });
  const fixture = TestBed.createComponent(type);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('OverviewAMrrComponent («Evolución MRR»)', () => {
  it('dibuja el MRR total como área desde el primer mes con datos', () => {
    const { fixture, el } = setup(OverviewAMrrComponent, { data: DATA });
    const chart = fixture.debugElement.query(By.directive(LineChartComponent)).componentInstance as LineChartComponent;
    expect(chart.categories()).toEqual(['ago 26', 'sept 26', 'oct 26']);
    expect(chart.values()).toEqual([1000, 1200, 1300]);
    expect(chart.area()).toBe(true);
    expect(chart.label()).toBe('MRR total');
    expect(el.querySelector('.card-note')?.textContent).toContain('agosto de 2026');
  });

  it('el selector cambia a un movimiento (churn): su serie mensual, sin área', () => {
    const { fixture, el } = setup(OverviewAMrrComponent, { data: DATA });
    const select = el.querySelector<HTMLSelectElement>('select')!;
    expect(Array.from(select.options).map(o => o.text)).toEqual(['MRR total', 'Nuevo', 'Expansión', 'Contracción', 'Churn', 'Reactivación']);
    select.value = 'churn';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const chart = fixture.debugElement.query(By.directive(LineChartComponent)).componentInstance as LineChartComponent;
    expect(chart.values()).toEqual([0, 100, 0]);
    expect(chart.area()).toBe(false);
    expect(chart.label()).toBe('Churn');
  });

  it('si falla, avisa con «Reintentar» que vuelve a pedir el dato', () => {
    const retry = vi.fn();
    const { el } = setup(OverviewAMrrComponent, { data: null, error: true, retry });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('No se pudo cargar el MRR.');
    el.querySelector<HTMLButtonElement>('.card-retry')!.click();
    expect(retry).toHaveBeenCalled();
  });

  it('mientras carga lo indica', () => {
    const { el } = setup(OverviewAMrrComponent, { data: null });
    expect(el.querySelector('[role=status]')?.textContent?.trim()).toBe('Cargando MRR…');
  });
});

describe('OverviewASignupsComponent («Altas y bajas de clientes»)', () => {
  it('compara por mes los clientes que empiezan a pagar con los que dejan de pagar', () => {
    const { fixture } = setup(OverviewASignupsComponent, { data: DATA });
    const chart = fixture.debugElement.query(By.directive(BarChartComponent)).componentInstance as BarChartComponent;
    expect(chart.categories()).toEqual(['ago 26', 'sept 26', 'oct 26']);
    expect(chart.series().map(s => [s.label, s.values])).toEqual([
      ['Altas', [2, 1, 0]],
      ['Bajas', [0, 1, 0]],
    ]);
  });

  it('el eje Y de un recuento usa ticks enteros: con máximo 1, «0» y «1» sin repetir', () => {
    const data: MrrOverview = { ...DATA, months: [month('2026-09', 1200, { signups: 1 }), month('2026-10', 1200, { cancellations: 1 })], dataSince: '2026-09' };
    const { el } = setup(OverviewASignupsComponent, { data });
    expect(Array.from(el.querySelectorAll('.chart__tick')).map(t => t.textContent?.trim())).toEqual(['0', '1']);
  });

  it('si falla, solo esta tarjeta muestra el error', () => {
    const { el } = setup(OverviewASignupsComponent, { data: null, error: true });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('No se pudieron cargar las altas y bajas.');
  });
});
