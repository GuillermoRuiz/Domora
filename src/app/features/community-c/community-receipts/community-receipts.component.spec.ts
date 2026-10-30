import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { AccountingReceipt } from '../../../core/models';
import { CommunityReceiptsComponent, type PaymentRequest } from './community-receipts.component';

const receipt = (id: string, overrides: Partial<AccountingReceipt> = {}): AccountingReceipt => ({
  id, no: `R-${id}`, periodKey: '2026-10', period: 'Octubre 2026', owner: '', unit: '', propertyId: 'p1', amount: 125, iban: '', mandate: '',
  concept: 'Cuota ordinaria · Octubre 2026', kind: 'Cuota ordinaria', status: 'Pendiente', outstanding: 125, date: '2026-10-01', method: 'Transferencia',
  ...overrides,
} as AccountingReceipt);

describe('CommunityReceiptsComponent', () => {
  let h: ComponentHarness<CommunityReceiptsComponent>;

  function mount(receipts: AccountingReceipt[] | null, failed = false): void {
    h = setupComponent(CommunityReceiptsComponent);
    h.fixture.componentRef.setInput('receipts', receipts);
    h.fixture.componentRef.setInput('failed', failed);
    h.fixture.detectChanges();
  }
  const rows = () => Array.from(h.el.querySelectorAll('[data-receipt]'));
  const row = (id: string) => h.el.querySelector(`[data-receipt="${id}"]`) as HTMLElement;
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('muestra concepto, periodo, importe y estado de cada recibo', () => {
    mount([receipt('r1', { amount: 125.5 })]);
    expect(text(row('r1'))).toMatch(/Cuota ordinaria\s?Octubre 2026\s?125,50\s?€\s?Pendiente/);
  });

  it.each([
    ['Pagada', 'Pagado', 'pill--positive'],
    ['Pendiente', 'Pendiente', 'pill--warning'],
    ['Parcial', 'Parcial', 'pill--warning'],
    ['Devuelto', 'Devuelto', 'pill--danger'],
  ] as const)('un recibo «%s» sale como «%s» con su tono', (status, label, cls) => {
    mount([receipt('r1', { status })]);
    expect(row('r1').querySelector('app-status-pill')?.textContent?.trim()).toBe(label);
    expect(row('r1').querySelector(`.${cls}`)).not.toBeNull();
  });

  it('enseña solo los 4 más recientes (el orden lo trae el servicio) y ofrece «Ver todos»', () => {
    mount(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(id => receipt(id)));
    expect(rows().map(r => r.getAttribute('data-receipt'))).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(h.el.querySelector('.section-card__action')?.textContent).toContain('Ver todos');
  });

  it('«Pagar» solo aparece en los recibos pendientes, parciales y devueltos', () => {
    mount([receipt('p', { status: 'Pagada' }), receipt('q', { status: 'Pendiente' }), receipt('r', { status: 'Parcial' }), receipt('s', { status: 'Devuelto' })]);
    expect(row('p').querySelector('[data-action="pay"]')).toBeNull();
    for (const id of ['q', 'r', 's']) expect(row(id).querySelector('[data-action="pay"]')).not.toBeNull();
  });

  it('«Pagar» pide pagar lo que queda por cobrar de ese recibo, no su importe original', () => {
    mount([receipt('r1', { amount: 125, outstanding: 40, status: 'Parcial' })]);
    const payments: PaymentRequest[] = [];
    h.component.pay.subscribe(p => payments.push(p));
    (row('r1').querySelector('[data-action="pay"]') as HTMLButtonElement).click();
    expect(payments).toEqual([{ amount: 40, concept: 'Cuota ordinaria · Octubre 2026', propertyId: 'p1' }]);
  });

  it('un recibo sin saldo calculado se paga por su importe', () => {
    mount([receipt('r1', { amount: 90, outstanding: undefined })]);
    const payments: PaymentRequest[] = [];
    h.component.pay.subscribe(p => payments.push(p));
    (row('r1').querySelector('[data-action="pay"]') as HTMLButtonElement).click();
    expect(payments[0].amount).toBe(90);
  });

  it('suma todo lo pendiente, también lo que no cabe en las 4 filas, y ofrece «Pagar ahora»', () => {
    mount([
      receipt('r1', { outstanding: 100 }), receipt('r2', { status: 'Pagada', outstanding: 0 }), receipt('r3', { outstanding: 50 }),
      receipt('r4', { status: 'Pagada', outstanding: 0 }), receipt('r5', { outstanding: 25.5 }),
    ]);
    expect(text(h.el.querySelector('[data-pending]'))).toMatch(/Pendiente de pago\s?175,50\s?€/);
    const payments: PaymentRequest[] = [];
    h.component.pay.subscribe(p => payments.push(p));
    (h.el.querySelector('[data-action="pay-all"]') as HTMLButtonElement).click();
    expect(payments).toEqual([{ amount: 175.5, concept: 'Saldo pendiente' }]);
  });

  it('si no hay nada pendiente no hay aviso de pago', () => {
    mount([receipt('r1', { status: 'Pagada', outstanding: 0 })]);
    expect(h.el.querySelector('[data-pending]')).toBeNull();
  });

  it('«Ver» y «Ver todos» piden abrir la lista de recibos', () => {
    mount([receipt('r1')]);
    let opened = 0;
    h.component.viewAll.subscribe(() => opened++);
    (row('r1').querySelector('[data-action="view"]') as HTMLButtonElement).click();
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(opened).toBe(2);
  });

  it('sin recibos lo dice y no ofrece «Ver todos»', () => {
    mount([]);
    expect(h.el.querySelector('[data-empty]')?.textContent).toContain('Todavía no tienes recibos');
    expect(h.el.querySelector('.section-card__action')).toBeNull();
  });

  it('mientras cargan dice que carga', () => {
    mount(null);
    expect(h.el.textContent).toContain('Cargando…');
  });

  it('si falla la carga lo avisa', () => {
    mount(null, true);
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar tus recibos');
  });
});
