import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { OfficeSetupService } from '../../core/office-setup.service';
import { PlatformMetricsService, type MrrOverview } from '../../core/platform-metrics.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { OverviewAComponent } from './overview-a.component';
import { Component, Input } from '@angular/core';

@Component({ selector: 'app-topbar', standalone: true, template: '' })
class TopbarStub {
  @Input() title = '';
  @Input() breadcrumb: string[] = [];
}

const MRR: MrrOverview = {
  currentMrr: 1300,
  payingClients: 3,
  dataSince: '2026-09',
  months: [
    { month: '2026-09', mrr: 1200, payingClients: 2, movements: { new: 1200, expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 1200, signups: 2, cancellations: 0 } },
    { month: '2026-10', mrr: 1300, payingClients: 3, movements: { new: 100, expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 100, signups: 1, cancellations: 0 } },
  ],
};

async function setup(over: Partial<Record<keyof PlatformMetricsService | 'listOffices', () => Promise<unknown>>> = {}) {
  const metrics = {
    mrr: vi.fn(() => Promise.resolve(MRR)),
    activity: vi.fn(() => Promise.resolve([])),
    attention: vi.fn(() => Promise.resolve([])),
    clientsSummary: vi.fn(() => Promise.resolve({ trials: 1, pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 } })),
    ...over,
  };
  const officeSetup = { listOffices: over.listOffices ?? vi.fn(() => Promise.resolve({ average: 50, offices: [] })) };
  TestBed.configureTestingModule({
    imports: [OverviewAComponent],
    providers: [
      provideRouter([]),
      { provide: PlatformMetricsService, useValue: metrics },
      { provide: OfficeSetupService, useValue: officeSetup },
    ],
  });
  TestBed.overrideComponent(OverviewAComponent, { remove: { imports: [TopbarComponent] }, add: { imports: [TopbarStub] } });
  const fixture = TestBed.createComponent(OverviewAComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, metrics };
}

describe('OverviewAComponent (Vista general de Domora)', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  it('pinta la fila de seis KPI, cada uno con su icono de información', async () => {
    const { el } = await setup();
    const cards = el.querySelectorAll('app-stat-card');
    expect(cards).toHaveLength(6);
    expect(el.querySelectorAll('app-stat-card .stat-card__info')).toHaveLength(6);
    expect(cards[1].querySelector('.stat-card__value')?.textContent?.trim()).toBe('1300 €');
  });

  it('pinta todas las tarjetas del panel, con «Soporte pendiente» como «Próximamente»', async () => {
    const { el } = await setup();
    const titles = Array.from(el.querySelectorAll('.section-card__title')).map(t => t.textContent?.trim());
    expect(titles).toEqual([
      'Evolución MRR', 'Altas y bajas de clientes', 'Administradores que requieren atención',
      'Onboarding y completitud', 'Soporte pendiente', 'Actividad reciente',
    ]);
    expect(el.querySelector('.support-soon')?.textContent).toContain('Próximamente');
  });

  it('si falla un endpoint, solo sus tarjetas muestran el error y el resto se ve', async () => {
    const { el } = await setup({ mrr: vi.fn(() => Promise.reject(new Error('500'))) });
    const alerts = Array.from(el.querySelectorAll('[role=alert]')).map(a => a.textContent?.trim() ?? '');
    expect(alerts.some(a => a.includes('No se pudo cargar el MRR.'))).toBe(true);
    expect(alerts.some(a => a.includes('No se pudieron cargar las altas y bajas.'))).toBe(true);
    expect(el.textContent).toContain('Ningún despacho requiere atención ahora mismo.');
    const trials = el.querySelectorAll('app-stat-card')[2];
    expect(trials.querySelector('.stat-card__value')?.textContent?.trim()).toBe('1');
  });

  it('«Reintentar» vuelve a pedir solo el endpoint que falló', async () => {
    let fail = true;
    const mrr = vi.fn(() => (fail ? Promise.reject(new Error('500')) : Promise.resolve(MRR)));
    const { fixture, el, metrics } = await setup({ mrr });
    fail = false;
    el.querySelector<HTMLButtonElement>('app-overview-a-mrr .card-retry')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(mrr).toHaveBeenCalledTimes(2);
    expect(metrics.attention).toHaveBeenCalledTimes(1);
    expect(el.querySelector('app-overview-a-mrr [role=alert]')).toBeNull();
  });
});
