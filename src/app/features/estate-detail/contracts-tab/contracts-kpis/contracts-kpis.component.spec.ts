import { setupComponent } from '../../../../core/testing/component-harness';
import type { ContractKpis, KpiShortcut } from '../contracts-model';
import { ContractsKpisComponent } from './contracts-kpis.component';

const kpis = (over: Partial<ContractKpis> = {}): ContractKpis => ({
  active: 12, total: 14, expiringSoon: 3, expired: 0, autoRenewals: 5, annualAmount: 24_580, withoutAnnual: 0, otherCurrency: 0, ...over,
});

describe('ContractsKpisComponent', () => {
  function mount(over: Partial<ContractKpis> = {}, selected: KpiShortcut | null = null) {
    const h = setupComponent(ContractsKpisComponent);
    h.fixture.componentRef.setInput('kpis', kpis(over));
    h.fixture.componentRef.setInput('selected', selected);
    h.fixture.detectChanges();
    return h;
  }
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const part = (h: { el: HTMLElement }, key: string, cls: string) => text(h.el.querySelector(`[data-kpi="${key}"] .${cls}`));

  it('muestra «12 de 14 contratos», «3 en los próximos 90 días», 5 renovaciones y el importe anual en euros', () => {
    const h = mount();
    expect(part(h, 'active', 'kpi__value')).toBe('12');
    expect(part(h, 'active', 'kpi__sub')).toBe('de 14 contratos');
    expect(part(h, 'expiring', 'kpi__value')).toBe('3');
    expect(part(h, 'expiring', 'kpi__sub')).toBe('en los próximos 90 días');
    expect(part(h, 'auto', 'kpi__value')).toBe('5');
    expect(part(h, 'auto', 'kpi__sub')).toBe('contratos con renovación tácita');
    expect(part(h, 'amount', 'kpi__value')).toBe('24.580,00 €');
    expect(h.el.querySelector('[data-note]')).toBeNull();
  });

  it('«vencen pronto» en rojo solo si hay alguno, con la línea de vencidos; singular y plural', () => {
    const h = mount({ expiringSoon: 0, expired: 0 });
    expect(h.el.querySelector('.kpi__value--danger')).toBeNull();
    expect(h.el.querySelector('[data-note="expired"]')).toBeNull();
    h.fixture.componentRef.setInput('kpis', kpis({ expiringSoon: 2, expired: 1, total: 1 }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('.kpi__value--danger')).not.toBeNull();
    expect(text(h.el.querySelector('[data-note="expired"]'))).toBe('1 vencido');
    expect(part(h, 'active', 'kpi__sub')).toBe('de 1 contrato');
    h.fixture.componentRef.setInput('kpis', kpis({ expired: 4 }));
    h.fixture.detectChanges();
    expect(text(h.el.querySelector('[data-note="expired"]'))).toBe('4 vencidos');
  });

  it('avisa de lo que no se ha podido sumar en el importe anual', () => {
    const h = mount({ withoutAnnual: 2, otherCurrency: 1 });
    const notes = Array.from(h.el.querySelectorAll('[data-note="amount"]')).map((n) => text(n));
    expect(notes).toEqual(['+2 sin importe anual', '+1 en otra moneda']);
  });

  it('cada ficha emite su atajo y la seleccionada queda marcada', () => {
    const h = mount({}, 'auto');
    const picked: KpiShortcut[] = [];
    h.component.pick.subscribe((k) => picked.push(k));
    for (const key of ['active', 'expiring', 'auto', 'amount']) (h.el.querySelector(`[data-kpi="${key}"]`) as HTMLButtonElement).click();
    expect(picked).toEqual(['active', 'expiring', 'auto', 'amount']);
    expect(h.el.querySelector('[data-kpi="auto"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(h.el.querySelector('[data-kpi="active"]')?.getAttribute('aria-pressed')).toBe('false');
  });
});
