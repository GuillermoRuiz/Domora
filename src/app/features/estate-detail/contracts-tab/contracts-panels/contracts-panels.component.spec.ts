import { setupComponent } from '../../../../core/testing/component-harness';
import type { ContractRenewal, EstateContract } from '../../../../core/models';
import { ContractsPanelsComponent } from './contracts-panels.component';

let seq = 0;
function contract(over: Partial<EstateContract> = {}): EstateContract {
  seq += 1;
  return {
    id: `c${seq}`, supplierId: 's1', estateId: 'e1', serviceType: `Servicio ${seq}`, startDate: '2024-01-01', endDate: '2026-12-31', renewalType: 'tacita',
    costAmount: 100, costFrequency: 'MONTHLY', currency: 'EUR', status: 'Activo', createdAt: '', updatedAt: '',
    supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, daysLeft: 200, annualCost: 1200, monthlyCost: 100, ...over,
  };
}
function renewal(n: number, over: Partial<ContractRenewal> = {}): ContractRenewal {
  return {
    id: `r${n}`, contractId: `c${n}`, serviceType: `Servicio ${n}`, supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' },
    renewedAt: '2026-01-10', previousEndDate: '2026-01-10', newEndDate: '2027-01-10', annualCost: 3600, currency: 'EUR', kind: 'manual', ...over,
  };
}
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').replace(/ /g, ' ').trim() ?? '';

describe('ContractsPanelsComponent', () => {
  function mount(contracts: EstateContract[], renewals: ContractRenewal[] = []) {
    const h = setupComponent(ContractsPanelsComponent);
    h.fixture.componentRef.setInput('contracts', contracts);
    h.fixture.componentRef.setInput('renewals', renewals);
    h.fixture.detectChanges();
    return h;
  }

  it('«Próximos vencimientos»: los 5 vigentes que vencen antes, con sus días restantes y su importe', () => {
    const list = [90, 5, 200, 40, 300, 10, 1].map((days, i) => contract({ id: `d${days}`, daysLeft: days, serviceType: `S${days}`, status: days <= 30 ? 'PorVencer' : 'Activo', endDate: '2026-12-31', annualCost: 100 * (i + 1) }));
    const h = mount([...list, contract({ id: 'late', status: 'Vencido', daysLeft: -4 }), contract({ id: 'off', status: 'Cancelado', daysLeft: 3 })]);
    const rows = Array.from(h.el.querySelectorAll('[data-upcoming]')).map((r) => r.getAttribute('data-upcoming'));
    expect(rows).toEqual(['d1', 'd5', 'd10', 'd40', 'd90']);
    const first = h.el.querySelector('[data-upcoming="d1"]');
    expect(text(first)).toContain('S1');
    expect(text(first)).toContain('Schindler');
    expect(text(first)).toContain('1 día');
    expect(text(first?.querySelector('.panels__num'))).toBe('700,00 €');
  });

  it('los días restantes se colorean según los umbrales (rojo ≤30, ámbar hasta 90, neutro después)', () => {
    const h = mount([
      contract({ id: 'a', daysLeft: 10, status: 'PorVencer' }), contract({ id: 'b', daysLeft: 60 }), contract({ id: 'c', daysLeft: 400 }), contract({ id: 'd', daysLeft: 0, status: 'PorVencer' }),
    ]);
    const tone = (id: string) => h.el.querySelector(`[data-upcoming="${id}"] .panels__dot`)?.className.match(/panels__dot--(\w+)/)?.[1];
    expect([tone('a'), tone('b'), tone('c'), tone('d')]).toEqual(['danger', 'warning', 'neutral', 'danger']);
    expect(text(h.el.querySelector('[data-upcoming="d"] .panels__days'))).toBe('Hoy');
  });

  it('«Ver» emite el contrato y «Ver todos» lo pide a la pantalla', () => {
    const c = contract({ id: 'x', daysLeft: 20, status: 'PorVencer' });
    const h = mount([c]);
    const seen: string[] = [];
    h.component.view.subscribe((x) => seen.push(`view:${x.id}`));
    h.component.viewAll.subscribe(() => seen.push('all'));
    (h.el.querySelector('.panels__view') as HTMLButtonElement).click();
    (h.el.querySelectorAll('.section-card__action')[0] as HTMLButtonElement).click();
    expect(seen).toEqual(['view:x', 'all']);
  });

  it('sin vencimientos próximos lo dice y no ofrece «Ver todos»', () => {
    const h = mount([contract({ endDate: null, daysLeft: null }), contract({ status: 'Vencido', daysLeft: -2 })]);
    expect(h.el.querySelector('[data-panel="upcoming-empty"]')).not.toBeNull();
    expect(Array.from(h.el.querySelectorAll('.section-card__action')).map((b) => text(b))).not.toContain('Ver todos');
  });

  it('«Últimas renovaciones»: las 5 más recientes con fecha, nuevo vencimiento, importe y tipo', () => {
    const renewals = [1, 2, 3, 4, 5, 6].map((n) => renewal(n, n === 1 ? { kind: 'tacita', annualCost: null, costAmount: 250, newEndDate: '2027-03-15' } : {}));
    const h = mount([], renewals);
    expect(h.el.querySelectorAll('[data-renewal]')).toHaveLength(5);
    const first = h.el.querySelector('[data-renewal="r1"]');
    expect(text(first)).toContain('Servicio 1');
    expect(text(first)).toContain('10/01/2026');
    expect(text(first)).toContain('15/03/2027');
    expect(text(first)).toContain('250,00 €'); // sin importe anual se muestra el del contrato
    expect(text(first)).toContain('Automática');
    expect(text(h.el.querySelector('[data-renewal="r2"]'))).toContain('3600,00 €');
    expect(text(h.el.querySelector('[data-renewal="r2"]'))).toContain('Manual');
  });

  it('«Ver histórico» solo aparece si hay renovaciones y se emite; sin ellas lo explica', () => {
    const none = mount([]);
    expect(none.el.querySelector('[data-panel="renewals-empty"]')?.textContent).toContain('Todavía no se ha registrado ninguna renovación');
    none.fixture.componentRef.setInput('renewals', [renewal(1)]);
    none.fixture.detectChanges();
    let history = 0;
    none.component.viewHistory.subscribe(() => (history += 1));
    const action = Array.from(none.el.querySelectorAll<HTMLButtonElement>('.section-card__action')).find((b) => text(b).includes('Ver histórico'));
    action!.click();
    expect(history).toBe(1);
  });
});
