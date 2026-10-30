import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { SaldosInicialesTabComponent } from './saldos-iniciales-tab.component';
import type { AccountingEstate, AccountingSettings, OpeningBalancesView } from '../../../core/models';

registerLocaleData(localeEs);

function makeEstate(): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
  };
}

function settings(overrides: Partial<AccountingSettings> = {}): AccountingSettings {
  return {
    cutoverDate: '2026-01-01', firstEntryDate: null, hasOpeningEntry: false, cutoverEditable: true,
    defaultReserveMode: 'receipt_share', defaultReserveSharePct: null,
    defaultReserveAllocationRule: null, defaultReserveAllocationValue: null,
    returnFeeRecharge: false,
    noPriorBalancesConfirmedAt: null,
    ...overrides,
  };
}

function draft(overrides: Partial<OpeningBalancesView> = {}): OpeningBalancesView {
  return {
    id: 'set1', status: 'Borrador', difference: null, differenceRole: null, differenceAccepted: false,
    postedAt: null, entryId: null, supersedesId: null,
    bankBalances: [], propertyDebts: [], propertyAdvances: [], supplierInvoices: [], otherBalances: [],
    ...overrides,
  };
}

function bank(overrides: Record<string, unknown> = {}) {
  return { id: 'b1', alias: 'Cuenta principal', accountCode: '5720001', ibanMasked: null, bic: null, bankName: null, isDefault: true, isReserveAccount: false, openedOn: null, closedAt: null, balance: '0', ...overrides };
}

function property(overrides: Record<string, unknown> = {}) {
  return { id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'a1', status: 'Ocupado', ref: 'A-101', ...overrides };
}

function supplier(overrides: Record<string, unknown> = {}) {
  return { id: 's1', administratorId: 'a1', estateId: 'e1', name: 'Ascensores García SL', category: 'Mantenimiento', status: 'Activo', lastInvoice: '', lastAmount: 0, ytdSpend: 0, ...overrides };
}

describe('SaldosInicialesTabComponent', () => {
  let h: ComponentHarness<SaldosInicialesTabComponent>;

  beforeEach(() => {
    h = setupComponent(SaldosInicialesTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  async function mount(opts: {
    settings?: AccountingSettings; view?: OpeningBalancesView;
    banks?: unknown[]; properties?: unknown[]; suppliers?: unknown[];
  } = {}) {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/accounting-settings`).flush(opts.settings ?? settings());
    h.http.expectOne(`${API}/estates/e1/opening-balances`).flush(opts.view ?? draft());
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush(opts.banks ?? [bank()]);
    h.http.expectOne(`${API}/estates/e1/properties`).flush(opts.properties ?? [property()]);
    h.http.expectOne(`${API}/estates/e1/suppliers`).flush(opts.suppliers ?? [supplier()]);
    await settle();
    h.fixture.detectChanges();
  }

  it('borrador vacío: modo edición y ofrece confirmar "sin saldos previos"', async () => {
    await mount();
    expect(h.component.editing()).toBe(true);
    expect(h.el.textContent).toContain('¿Esta finca ya llevaba contabilidad en otro programa?');
  });

  it('confirmar "sin saldos previos" manda POST y recarga la configuración', async () => {
    await mount();
    const confirm = h.component.confirmNoPriorBalances();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances/no-prior-balances` && r.method === 'POST');
    req.flush({});
    await settle();
    const settingsReq = h.http.expectOne(`${API}/estates/e1/accounting-settings`);
    settingsReq.flush(settings({ noPriorBalancesConfirmedAt: '2026-02-01T10:00:00.000Z' }));
    await confirm;
    h.fixture.detectChanges();
    expect(h.component.settings()?.noPriorBalancesConfirmedAt).toBe('2026-02-01T10:00:00.000Z');
    expect(h.el.textContent).toContain('Confirmado el 1/2/2026');
  });

  it('añadir un saldo bancario lo agrega a la lista con el alias resuelto', async () => {
    await mount();
    h.component.bankAccountIdDraft.set('b1');
    h.component.bankBalanceDraft.set('12.500,50');
    h.component.addBank();
    expect(h.component.bankRows()).toEqual([{ bankAccountId: 'b1', balance: 12500.5 }]);
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cuenta principal');
  });

  it('no deja añadir dos saldos para la misma cuenta bancaria', async () => {
    await mount();
    h.component.bankAccountIdDraft.set('b1');
    h.component.bankBalanceDraft.set('100');
    h.component.addBank();
    h.component.bankAccountIdDraft.set('b1');
    h.component.bankBalanceDraft.set('200');
    h.component.addBank();
    expect(h.component.bankRows()).toHaveLength(1);
    expect(h.component.rowError()).toContain('ya tiene un saldo');
  });

  it('añadir una deuda exige año, concepto e importe válidos', async () => {
    await mount();
    h.component.debtPropertyIdDraft.set('p1');
    h.component.debtAmountDraft.set('450');
    h.component.addDebt(); // sin concepto
    expect(h.component.debtRows()).toHaveLength(0);
    expect(h.component.rowError()).toBeTruthy();

    h.component.debtConceptDraft.set('Cuotas 2024 pendientes');
    h.component.debtOriginYearDraft.set('2024');
    h.component.addDebt();
    expect(h.component.debtRows()).toEqual([
      { propertyId: 'p1', originYear: 2024, concept: 'Cuotas 2024 pendientes', amount: 450, dueDate: undefined },
    ]);
  });

  it('quitar una fila la elimina del borrador local', async () => {
    await mount();
    h.component.advPropertyIdDraft.set('p1');
    h.component.advConceptDraft.set('Anticipo obras');
    h.component.advAmountDraft.set('80');
    h.component.addAdvance();
    expect(h.component.advanceRows()).toHaveLength(1);
    h.component.removeAdvance(0);
    expect(h.component.advanceRows()).toHaveLength(0);
  });

  it('guardar el borrador manda PUT con todas las filas', async () => {
    await mount();
    h.component.otherConceptDraft.set('Fondo de reserva');
    h.component.otherAmountDraft.set('50');
    h.component.otherRoleDraft.set('reserve_fund');
    h.component.otherSideDraft.set('debit');
    h.component.addOther();

    const save = h.component.saveDraft();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances` && r.method === 'PUT');
    expect(req.request.body).toEqual({
      bankBalances: [], propertyDebts: [], propertyAdvances: [], supplierInvoices: [],
      otherBalances: [{ role: 'reserve_fund', concept: 'Fondo de reserva', side: 'debit', amount: 50 }],
    });
    req.flush(draft({ otherBalances: [{ id: 'o1', role: 'reserve_fund', concept: 'Fondo de reserva', side: 'debit', amount: 50 }] }));
    await save;
    h.fixture.detectChanges();
    expect(h.el.querySelector('.toast')?.textContent).toContain('Borrador guardado');
  });

  it('calcular la diferencia guarda primero y luego valida', async () => {
    await mount();
    h.component.invSupplierIdDraft.set('s1');
    h.component.invNumberDraft.set('F-1');
    h.component.invConceptDraft.set('Mantenimiento');
    h.component.invIssueDateDraft.set('2025-11-01');
    h.component.invAmountDraft.set('300');
    h.component.addInvoice();

    const refresh = h.component.refreshDifference();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances` && r.method === 'PUT').flush(draft());
    await settle();
    const validateReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances/validate` && r.method === 'POST');
    validateReq.flush({ debit: 0, credit: 300, difference: -300, bankMismatches: [] });
    await refresh;
    h.fixture.detectChanges();

    expect(h.component.validateResult()?.difference).toBe(-300);
    // Hay una factura -> exige elegir a dónde va la contrapartida, aunque cuadrara.
    expect(h.component.needsDifferenceRole()).toBe(true);
    expect(h.el.querySelector('#difference-role')).toBeTruthy();
  });

  it('confirmar contabiliza (post) cuando no es una corrección', async () => {
    await mount();
    h.component.bankAccountIdDraft.set('b1');
    h.component.bankBalanceDraft.set('1000');
    h.component.addBank();

    const confirm = h.component.confirmPost();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances` && r.method === 'PUT').flush(draft());
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances/validate` && r.method === 'POST')
      .flush({ debit: 1000, credit: 0, difference: 1000, bankMismatches: [] });
    await settle();
    h.fixture.detectChanges();

    const postReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances/post` && r.method === 'POST');
    expect(postReq.request.body).toEqual({ differenceRole: 'reserve_fund' });
    postReq.flush(draft({ status: 'Contabilizado', postedAt: '2026-02-01T10:00:00.000Z', difference: 1000 }));
    await confirm;
    h.fixture.detectChanges();

    expect(h.component.editing()).toBe(false);
    expect(h.el.textContent).toContain('Contabilizado');
  });

  it('sobre un set ya contabilizado, "Corregir" entra en edición; confirmar llama a repost', async () => {
    await mount({ view: draft({ status: 'Contabilizado', postedAt: '2026-01-01T00:00:00.000Z', supersedesId: null }) });
    expect(h.component.editing()).toBe(false);
    expect(h.el.textContent).toContain('Corregir saldos iniciales');

    h.component.startCorrection();
    // Simula que ya se guardó un borrador que sustituye al contabilizado (lo que hace saveDraft() en el backend real).
    h.component.view.set(draft({ status: 'Borrador', supersedesId: 'set1' }));
    h.fixture.detectChanges();
    expect(h.component.isCorrection()).toBe(true);

    h.component.bankAccountIdDraft.set('b1');
    h.component.bankBalanceDraft.set('500');
    h.component.addBank();
    const confirm = h.component.confirmPost();
    h.http.expectOne((r) => r.method === 'PUT').flush(draft({ supersedesId: 'set1' }));
    await settle();
    h.http.expectOne((r) => r.url.endsWith('/validate')).flush({ debit: 500, credit: 0, difference: 500, bankMismatches: [] });
    await settle();
    h.fixture.detectChanges();

    const repostReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/opening-balances/repost` && r.method === 'POST');
    repostReq.flush(draft({ status: 'Contabilizado', supersedesId: 'set1' }));
    await confirm;
  });

  it('si el backend rechaza el borrador (p.ej. cuenta de otra finca), muestra el mensaje', async () => {
    await mount();
    const save = h.component.saveDraft();
    h.http.expectOne((r) => r.method === 'PUT').flush(
      { message: 'Alguna cuenta bancaria, propiedad o proveedor del borrador no pertenece a esta finca.' },
      { status: 422, statusText: 'Unprocessable' },
    );
    await save;
    expect(h.component.saveError()).toContain('no pertenece a esta finca');
  });
});
