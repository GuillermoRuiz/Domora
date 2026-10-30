import { setupComponent } from '../../../../core/testing/component-harness';
import type { EstateContract } from '../../../../core/models';
import { ContractsTableComponent } from './contracts-table.component';

let seq = 0;
function contract(over: Partial<EstateContract> = {}): EstateContract {
  seq += 1;
  return {
    id: `c${seq}`, supplierId: 's1', estateId: 'e1', serviceType: 'Ascensor (mantenimiento)', startDate: '2024-01-01', endDate: '2026-03-15',
    renewalType: 'tacita', costAmount: 300, costFrequency: 'MONTHLY', currency: 'EUR', status: 'Activo', createdAt: '', updatedAt: '',
    supplier: { id: 's1', name: 'Schindler Ibérica', category: 'Ascensores' }, daysLeft: 200, annualCost: 3600, monthlyCost: 300, documentCount: 0, ...over,
  };
}
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').replace(/ /g, ' ').trim() ?? '';

describe('ContractsTableComponent', () => {
  function mount(contracts: EstateContract[]) {
    const h = setupComponent(ContractsTableComponent);
    h.fixture.componentRef.setInput('contracts', contracts);
    h.fixture.detectChanges();
    return h;
  }
  const row = (h: { el: HTMLElement }, id: string) => h.el.querySelector(`[data-contract="${id}"]`) as HTMLElement;

  it('tiene las columnas del mockup', () => {
    const h = mount([contract()]);
    const headers = Array.from(h.el.querySelectorAll('thead th')).map((th) => text(th));
    expect(headers).toEqual(['Contrato / Servicio', 'Proveedor', 'Inicio', 'Vencimiento', 'Renovación', 'Importe', 'Estado', 'Alerta', 'Acción']);
  });

  it('contrato con su categoría, proveedor con iniciales, fechas, renovación, importe anual y mensual, estado y alerta', () => {
    const c = contract({ id: 'a' });
    const h = mount([c]);
    const r = row(h, 'a');
    expect(text(r.querySelector('.table__service'))).toBe('Ascensor (mantenimiento)');
    expect(text(r.querySelector('.table__category'))).toBe('Ascensores');
    expect(text(r.querySelector('.table__supplier-name'))).toBe('Schindler Ibérica');
    expect(text(r.querySelector('app-avatar'))).toBe('SI');
    expect(text(r.querySelector('[data-label="Inicio"]'))).toBe('01/01/2024');
    expect(text(r.querySelector('[data-label="Vencimiento"]'))).toBe('15/03/2026');
    expect(text(r.querySelector('[data-label="Renovación"]'))).toBe('Automática');
    expect(text(r.querySelector('.table__amount'))).toBe('3600,00 €');
    expect(text(r.querySelector('.table__amount-sub'))).toBe('(300,00 €/mes)');
    expect(text(r.querySelector('app-status-pill'))).toBe('Activo');
    expect(text(r.querySelector('.table__alert'))).toContain('Vence en 7 meses');
  });

  it('el vencimiento y la alerta se pintan según la cercanía (rojo ≤30 días o vencido, ámbar hasta 90, neutro después)', () => {
    const h = mount([
      contract({ id: 'late', status: 'Vencido', daysLeft: -10 }),
      contract({ id: 'soon', status: 'PorVencer', daysLeft: 20 }),
      contract({ id: 'mid', daysLeft: 60 }),
      contract({ id: 'far', daysLeft: 300 }),
    ]);
    const tone = (id: string) => row(h, id).querySelector('.table__alert')?.getAttribute('data-alert-tone');
    expect([tone('late'), tone('soon'), tone('mid'), tone('far')]).toEqual(['danger', 'danger', 'warning', 'neutral']);
    expect(row(h, 'late').querySelector('.table__end--danger')).not.toBeNull();
    expect(row(h, 'mid').querySelector('.table__end--warning')).not.toBeNull();
    expect(row(h, 'far').querySelector('.table__end--neutral')).not.toBeNull();
    expect(text(row(h, 'late').querySelector('.table__alert'))).toBe('Vencido hace 10 días');
  });

  it('sin fecha de fin, cancelado, puntual y sin importe', () => {
    const h = mount([
      contract({ id: 'open', endDate: null, daysLeft: null }),
      contract({ id: 'off', status: 'Cancelado', cancelledAt: '2026-02-01' }),
      contract({ id: 'once', costFrequency: 'ONE_OFF', costAmount: 900, annualCost: null, monthlyCost: null }),
      contract({ id: 'none', costAmount: null, costFrequency: null, annualCost: null, monthlyCost: null }),
    ]);
    expect(text(row(h, 'open').querySelector('[data-label="Vencimiento"]'))).toBe('Indefinido');
    expect(text(row(h, 'open').querySelector('.table__alert'))).toBe('Sin vencimiento');
    expect(row(h, 'off').classList.contains('table__row--cancelled')).toBe(true);
    expect(text(row(h, 'off').querySelector('.table__alert'))).toBe('Cancelado el 01/02/2026');
    expect(text(row(h, 'off').querySelector('app-status-pill'))).toBe('Cancelado');
    expect(text(row(h, 'once').querySelector('.table__amount'))).toBe('900,00 €');
    expect(text(row(h, 'once').querySelector('.table__amount-sub'))).toBe('Pago único');
    expect(text(row(h, 'none').querySelector('.table__amount'))).toBe('—');
    expect(row(h, 'none').querySelector('.table__amount-sub')).toBeNull();
  });

  it('cada celda lleva su rótulo para la vista de tarjetas en móvil', () => {
    const h = mount([contract({ id: 'a' })]);
    const labels = Array.from(row(h, 'a').querySelectorAll('td[data-label]')).map((td) => td.getAttribute('data-label'));
    expect(labels).toEqual(['Contrato', 'Proveedor', 'Inicio', 'Vencimiento', 'Renovación', 'Importe', 'Estado', 'Alerta']);
  });

  it('«Ver» emite el contrato y su etiqueta accesible dice cuál es', () => {
    const c = contract({ id: 'a' });
    const h = mount([c]);
    const seen: EstateContract[] = [];
    h.component.view.subscribe((x) => seen.push(x));
    const button = row(h, 'a').querySelector('.table__view') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Ver Ascensor (mantenimiento) de Schindler Ibérica');
    button.click();
    expect(seen).toEqual([c]);
  });

  describe('menú «⋯» (D1)', () => {
    const more = (h: { el: HTMLElement }, id: string) => row(h, id).querySelector('.table__more') as HTMLButtonElement;
    const items = (h: { el: HTMLElement }) => Array.from(h.el.querySelectorAll('.menu__item')).map((b) => text(b));

    it('un contrato activo ofrece Editar, Renovar, Cancelar y Ver proveedor', () => {
      const h = mount([contract({ id: 'a' })]);
      expect(h.el.querySelector('.menu')).toBeNull();
      more(h, 'a').click();
      h.fixture.detectChanges();
      expect(items(h)).toEqual(['Editar', 'Renovar', 'Cancelar contrato', 'Ver proveedor']);
      expect(more(h, 'a').getAttribute('aria-expanded')).toBe('true');
    });

    it('un cancelado solo permite ver al proveedor y uno indefinido no se puede renovar', () => {
      const h = mount([contract({ id: 'off', status: 'Cancelado' }), contract({ id: 'open', endDate: null, daysLeft: null })]);
      more(h, 'off').click();
      h.fixture.detectChanges();
      expect(items(h)).toEqual(['Ver proveedor']);
      more(h, 'open').click(); // abrir otro cambia el menú
      h.fixture.detectChanges();
      expect(items(h)).toEqual(['Editar', 'Cancelar contrato', 'Ver proveedor']);
    });

    it('cada opción emite su acción con el contrato y cierra el menú', () => {
      const c = contract({ id: 'a' });
      const h = mount([c]);
      const seen: string[] = [];
      h.component.edit.subscribe((x) => seen.push(`edit:${x.id}`));
      h.component.renew.subscribe((x) => seen.push(`renew:${x.id}`));
      h.component.cancel.subscribe((x) => seen.push(`cancel:${x.id}`));
      h.component.openSupplier.subscribe((x) => seen.push(`supplier:${x.id}`));
      for (const action of ['edit', 'renew', 'cancel', 'supplier']) {
        more(h, 'a').click();
        h.fixture.detectChanges();
        (h.el.querySelector(`[data-action="${action}"]`) as HTMLButtonElement).click();
        h.fixture.detectChanges();
        expect(h.el.querySelector('.menu')).toBeNull();
      }
      expect(seen).toEqual(['edit:a', 'renew:a', 'cancel:a', 'supplier:a']);
    });

    it('pulsar el mismo botón, Escape o fuera lo cierra', () => {
      const h = mount([contract({ id: 'a' })]);
      more(h, 'a').click();
      h.fixture.detectChanges();
      more(h, 'a').click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('.menu')).toBeNull();
      more(h, 'a').click();
      h.fixture.detectChanges();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      h.fixture.detectChanges();
      expect(h.el.querySelector('.menu')).toBeNull();
      more(h, 'a').click();
      h.fixture.detectChanges();
      document.body.click();
      h.fixture.detectChanges();
      expect(h.el.querySelector('.menu')).toBeNull();
    });

    it('el botón y el menú son accesibles (rol, etiqueta y flechas para moverse)', async () => {
      const h = mount([contract({ id: 'a' })]);
      expect(more(h, 'a').getAttribute('aria-haspopup')).toBe('menu');
      expect(more(h, 'a').getAttribute('aria-label')).toBe('Más acciones de Ascensor (mantenimiento) de Schindler Ibérica');
      more(h, 'a').click();
      h.fixture.detectChanges();
      await Promise.resolve();
      expect(h.el.querySelector('.menu')?.getAttribute('role')).toBe('menu');
      const buttons = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.menu button'));
      expect(buttons.every((b) => b.getAttribute('role') === 'menuitem')).toBe(true);
      buttons[0]!.focus();
      buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement).toBe(buttons[1]);
      buttons[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      buttons[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(document.activeElement).toBe(buttons.at(-1));
    });
  });
});
