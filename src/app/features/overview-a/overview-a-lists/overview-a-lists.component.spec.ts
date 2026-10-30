import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { AttentionItem } from '../../../core/models';
import type { CompletenessOverview, OfficeCompleteness } from '../../../core/office-setup.service';
import type { PlatformEvent } from '../../../core/platform-metrics.service';
import { OverviewAActivityComponent } from './overview-a-activity.component';
import { OverviewAAttentionComponent } from './overview-a-attention.component';
import { OverviewACompletenessComponent } from './overview-a-completeness.component';

function setup<T>(type: new (...args: any[]) => T, inputs: Record<string, unknown>) {
  TestBed.configureTestingModule({ imports: [type], providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(type);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const attention = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  administratorId: 'a1',
  name: 'Fincas Sol',
  plan: 'STANDARD',
  clientStatus: 'Activo',
  paymentStatus: 'Vencido',
  completeness: 62.5,
  salud: 55.6,
  atRisk: true,
  reasons: [{ code: 'overdue_payment', label: 'Pagos vencidos', severity: 3 }, { code: 'low_activity', label: 'Baja actividad', severity: 2 }],
  ...over,
});

describe('OverviewAAttentionComponent («Administradores que requieren atención»)', () => {
  it('lista cliente, plan, estado, pago, completitud, salud y motivos', () => {
    const { el } = setup(OverviewAAttentionComponent, { data: [attention()] });
    expect(Array.from(el.querySelectorAll('thead th')).map(th => th.textContent?.trim())).toEqual(
      ['Cliente', 'Plan', 'Estado', 'Pago', 'Completitud', 'Salud', 'Motivos', 'Acciones'],
    );
    const cells = Array.from(el.querySelectorAll('tbody tr:first-child td')).map(td => td.textContent?.replace(/\s+/g, ' ').trim());
    expect(cells).toEqual(['Fincas Sol', 'STANDARD', 'Activo', 'Vencido', '62,5 %', '55,6 En riesgo', 'Pagos vencidosBaja actividad', 'Ver fichaVer facturación']);
    expect(Array.from(el.querySelectorAll('.table__reasons li')).map(li => li.textContent?.trim())).toEqual(['Pagos vencidos', 'Baja actividad']);
  });

  it('un despacho cancelado no tiene salud: guion', () => {
    const { el } = setup(OverviewAAttentionComponent, { data: [attention({ salud: null, atRisk: false })] });
    expect(el.querySelectorAll('tbody td')[5].textContent?.trim()).toBe('—');
  });

  it('el nombre enlaza a su ficha y pulsar la fila también la abre', () => {
    const { fixture, el } = setup(OverviewAAttentionComponent, { data: [attention()] });
    expect(el.querySelector('tbody a')?.getAttribute('href')).toBe('/a/admins/a1');
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (el.querySelector('tbody tr td:nth-child(2)') as HTMLElement).click();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/a/admins', 'a1']);
  });

  it('«Acciones»: «Ver ficha» y, con pagos vencidos, «Ver facturación» (pestaña Facturación), enlaces de teclado que no disparan la fila', () => {
    const { fixture, el } = setup(OverviewAAttentionComponent, { data: [attention()] });
    const actions = Array.from(el.querySelectorAll<HTMLAnchorElement>('tbody tr td:last-child a'));
    expect(actions.map(a => a.textContent?.trim())).toEqual(['Ver ficha', 'Ver facturación']);
    expect(actions.map(a => a.getAttribute('href'))).toEqual(['/a/admins/a1', '/a/admins/a1?tab=facturacion']);
    expect(actions.map(a => a.getAttribute('aria-label'))).toEqual(['Ver ficha de Fincas Sol', 'Ver facturación de Fincas Sol']);

    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const byUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    actions[1].click();
    fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    expect(byUrl).toHaveBeenCalledTimes(1);
    expect(router.serializeUrl(byUrl.mock.calls[0][0] as never)).toBe('/a/admins/a1?tab=facturacion');
  });

  it('«Acciones» sin pagos vencidos solo ofrece «Ver ficha»', () => {
    const { el } = setup(OverviewAAttentionComponent, {
      data: [attention({ paymentStatus: 'Al día', reasons: [{ code: 'low_activity', label: 'Baja actividad', severity: 2 }] })],
    });
    expect(Array.from(el.querySelectorAll('tbody tr td:last-child a')).map(a => a.textContent?.trim())).toEqual(['Ver ficha']);
  });

  it('«Ver todos» lleva al listado de administradores', () => {
    const { el } = setup(OverviewAAttentionComponent, { data: [attention()] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>('.section-card__action')!.click();
    expect(navigate).toHaveBeenCalledWith(['/a/admins']);
  });

  it('muestra como mucho 5 filas', () => {
    const items = Array.from({ length: 7 }, (_, i) => attention({ administratorId: `a${i}`, name: `D${i}` }));
    const { el } = setup(OverviewAAttentionComponent, { data: items });
    expect(el.querySelectorAll('tbody tr')).toHaveLength(5);
  });

  it('sin despachos que atender lo dice', () => {
    const { el } = setup(OverviewAAttentionComponent, { data: [] });
    expect(el.querySelector('.card-message')?.textContent?.trim()).toBe('Ningún despacho requiere atención ahora mismo.');
  });

  it('si falla, solo esta tarjeta muestra el error', () => {
    const { el } = setup(OverviewAAttentionComponent, { data: null, error: true });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('No se pudieron cargar los despachos que requieren atención.');
  });
});

const office = (id: string, total: number, over: Partial<OfficeCompleteness> = {}): OfficeCompleteness => ({
  administratorId: id, name: `Despacho ${id}`, office: total, estates: total, total, estateCount: 2, onboardingComplete: false, includedInAverage: true, ...over,
});

describe('OverviewACompletenessComponent («Onboarding y completitud»)', () => {
  const data: CompletenessOverview = {
    average: 60,
    offices: [office('a', 90), office('b', 20), office('c', 70), office('x', 0, { includedInAverage: false })],
  };

  it('ordena los despachos de menor a mayor completitud, sin los cancelados, con su barra', () => {
    const { el } = setup(OverviewACompletenessComponent, { data });
    expect(Array.from(el.querySelectorAll('.row a')).map(a => a.textContent?.trim())).toEqual(['Despacho b', 'Despacho c', 'Despacho a']);
    expect(Array.from(el.querySelectorAll('.row__side')).map(s => s.textContent?.trim())).toEqual(['20 %', '70 %', '90 %']);
    expect(el.querySelectorAll('app-progress-bar')).toHaveLength(3);
    expect(el.querySelector('.card-note')?.textContent).toContain('Media: 60 %');
  });

  it('cada despacho enlaza a su ficha', () => {
    const { el } = setup(OverviewACompletenessComponent, { data });
    expect(el.querySelector('.row a')?.getAttribute('href')).toBe('/a/admins/b');
  });

  it('sin despachos lo dice', () => {
    const { el } = setup(OverviewACompletenessComponent, { data: { average: null, offices: [] } });
    expect(el.querySelector('.card-message')?.textContent?.trim()).toBe('Todavía no hay despachos que medir.');
  });
});

const event = (type: PlatformEvent['type'], id = type): PlatformEvent => ({
  id, type, title: `Evento ${type}`, occurredAt: '2026-10-26T09:00:00Z', administrator: { id: 'a1', name: 'Fincas Sol' },
});

describe('OverviewAActivityComponent («Actividad reciente»)', () => {
  const NOW = new Date('2026-10-26T12:00:00Z');

  it('cada tipo de evento lleva su icono, el despacho y el tiempo relativo', () => {
    const types: PlatformEvent['type'][] = ['signup', 'plan_change', 'payment_received', 'cancellation_requested', 'onboarding_completed'];
    const { el } = setup(OverviewAActivityComponent, { data: types.map(t => event(t)), now: NOW });
    expect(Array.from(el.querySelectorAll('.row')).map(r => r.getAttribute('data-icon'))).toEqual(['user', 'repeat', 'card', 'x', 'check-check']);
    const first = el.querySelector('.row')!;
    expect(first.querySelector('.row__text')?.textContent).toContain('Evento signup');
    expect(first.querySelector('a')?.textContent?.trim()).toBe('Fincas Sol');
    expect(first.querySelector('a')?.getAttribute('href')).toBe('/a/admins/a1');
    expect(first.querySelector('time')?.textContent?.trim()).toBe('hace 3 h');
  });

  it('sin actividad lo dice', () => {
    const { el } = setup(OverviewAActivityComponent, { data: [] });
    expect(el.querySelector('.card-message')?.textContent?.trim()).toBe('Todavía no hay actividad de negocio.');
  });

  it('si falla, solo esta tarjeta muestra el error', () => {
    const { el } = setup(OverviewAActivityComponent, { data: null, error: true });
    expect(el.querySelector('[role=alert]')?.textContent).toContain('No se pudo cargar la actividad.');
  });
});
