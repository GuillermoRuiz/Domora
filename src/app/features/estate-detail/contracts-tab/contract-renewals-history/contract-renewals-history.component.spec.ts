import { setupComponent } from '../../../../core/testing/component-harness';
import type { ContractRenewal } from '../../../../core/models';
import { ContractRenewalsHistoryComponent } from './contract-renewals-history.component';

const renewal = (n: number, over: Partial<ContractRenewal> = {}): ContractRenewal => ({
  id: `r${n}`, contractId: `c${n}`, serviceType: `Servicio ${n}`, supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' },
  renewedAt: '2026-01-10', previousEndDate: '2026-01-10', newEndDate: '2027-01-10', annualCost: 1200, currency: 'EUR', kind: 'manual', ...over,
});
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').replace(/ /g, ' ').trim() ?? '';

describe('ContractRenewalsHistoryComponent', () => {
  function mount(renewals: ContractRenewal[]) {
    const h = setupComponent(ContractRenewalsHistoryComponent);
    h.component.renewals = renewals;
    h.fixture.detectChanges();
    return h;
  }

  it('lista todas las renovaciones con su vencimiento anterior y nuevo, importe, tipo y notas', () => {
    const h = mount([renewal(1, { notes: 'Subida del IPC', kind: 'tacita' }), renewal(2, { previousEndDate: null, annualCost: null, costAmount: null })]);
    expect(text(h.el.querySelector('.modal__subtitle'))).toBe('2 renovaciones registradas');
    const first = h.el.querySelector('[data-renewal="r1"]');
    expect(text(first)).toContain('Servicio 1');
    expect(text(first)).toContain('Schindler');
    expect(text(first)).toContain('10/01/2026');
    expect(text(first)).toContain('10/01/2027');
    expect(text(first)).toContain('1200,00 €');
    expect(text(first)).toContain('Automática');
    expect(text(first)).toContain('Subida del IPC');
    const second = h.el.querySelector('[data-renewal="r2"]');
    expect(text(second!.querySelectorAll('td')[2])).toBe('—'); // sin vencimiento anterior
    expect(text(second!.querySelector('.history__num'))).toBe('—');
  });

  it('en singular, vacío y con cierre', () => {
    const h = mount([renewal(1)]);
    expect(text(h.el.querySelector('.modal__subtitle'))).toBe('1 renovación registrada');
    let closed = 0;
    h.component.closed.subscribe(() => (closed += 1));
    (h.el.querySelector('.close-btn') as HTMLButtonElement).click();
    expect(closed).toBe(1);
    h.component.renewals = [];
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Todavía no se ha registrado ninguna renovación');
  });
});
