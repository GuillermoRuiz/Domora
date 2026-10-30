import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { AjustesContablesTabComponent } from './ajustes-contables-tab.component';
import type { AccountingEstate, AccountingSettings } from '../../../core/models';

// El pipe currency usa 'es'; en la app lo registra app.config.ts.
registerLocaleData(localeEs);

function makeEstate(): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
  };
}

function settings(overrides: Partial<AccountingSettings> = {}): AccountingSettings {
  return {
    cutoverDate: '2026-09-01', firstEntryDate: null, hasOpeningEntry: false, cutoverEditable: true,
    defaultReserveMode: 'receipt_share', defaultReserveSharePct: null,
    defaultReserveAllocationRule: null, defaultReserveAllocationValue: null,
    returnFeeRecharge: false,
    noPriorBalancesConfirmedAt: null,
    ...overrides,
  };
}

function bank(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1', alias: 'Cuenta principal', accountCode: '5720001', ibanMasked: 'ES91 ···· 1332', bic: null,
    bankName: 'CaixaBank', isDefault: true, isReserveAccount: false, openedOn: null, closedAt: null, balance: '1500.00',
    ...overrides,
  };
}

describe('AjustesContablesTabComponent', () => {
  let h: ComponentHarness<AjustesContablesTabComponent>;

  beforeEach(() => {
    h = setupComponent(AjustesContablesTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  const YEAR = new Date().getFullYear();
  function fiscalYear(overrides: Record<string, unknown> = {}) {
    return { id: 'fy1', estateId: 'e1', year: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, status: 'Abierto', reserveMode: 'receipt_share', reserveSharePct: null, ...overrides };
  }

  async function mount(
    s = settings(),
    banks: unknown[] = [bank(), bank({ id: 'b2', alias: 'Obras', accountCode: '5720002', isDefault: false, isReserveAccount: true, balance: '0' })],
    years: unknown[] = [fiscalYear()],
    reserveApplications: unknown[] = [],
  ) {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/accounting-settings`).flush(s);
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush(banks);
    h.http.expectOne(`${API}/estates/e1/fiscal-years`).flush(years);
    h.http.expectOne(`${API}/estates/e1/reserve-fund-applications`).flush(reserveApplications);
    await settle();
    h.fixture.detectChanges();
  }

  it('muestra la fecha de inicio editable y las cuentas con saldo e IBAN enmascarado', async () => {
    await mount();
    expect((h.el.querySelector('#cutover-date') as HTMLInputElement).value).toBe('2026-09-01');
    const rows = Array.from(h.el.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('ES91 ···· 1332');
    expect(rows[0].textContent).toContain('Por defecto');
    expect(rows[0].textContent).toMatch(/1\.500,00/);
    expect(rows[1].textContent).toContain('Fondo de reserva');
  });

  it('adelantar la fecha de inicio manda PUT y actualiza la vista', async () => {
    await mount();
    h.component.cutoverDraft.set('2026-01-01');
    const save = h.component.saveCutover();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/accounting-settings` && r.method === 'PUT');
    expect(req.request.body).toEqual({ cutoverDate: '2026-01-01' });
    req.flush(settings({ cutoverDate: '2026-01-01' }));
    await save;
    h.fixture.detectChanges();
    expect(h.el.querySelector('.toast')?.textContent).toContain('Fecha de inicio contable actualizada');
  });

  it('no deja poner la fecha después del primer asiento', async () => {
    await mount(settings({ firstEntryDate: '2026-09-05' }));
    h.component.cutoverDraft.set('2026-10-01');
    await h.component.saveCutover();
    expect(h.component.cutoverError()).toContain('Ya hay asientos desde el 2026-09-05');
    h.http.expectNone((r) => r.method === 'PUT');
  });

  it('con asiento de apertura, la fecha se muestra fija y sin campo editable', async () => {
    await mount(settings({ hasOpeningEntry: true, cutoverEditable: false }));
    expect(h.el.querySelector('#cutover-date')).toBeNull();
    expect(h.el.textContent).toContain('ya hay asiento de apertura');
  });

  describe('fondo de reserva del ejercicio', () => {
    it('muestra la configuración del ejercicio en curso', async () => {
      await mount(settings(), undefined, [fiscalYear({ reserveMode: 'receipt_share', reserveSharePct: '9.10' })]);
      expect(h.component.reserveModeDraft()).toBe('receipt_share');
      expect((h.el.querySelector('#reserve-pct') as HTMLInputElement).value).toBe('9.1');
    });

    it('"Usar el mínimo legal" propone 9,10 % y guardar actualiza el ejercicio y el valor por defecto', async () => {
      await mount();
      h.component.useLegalMinimum();
      const save = h.component.saveReserve();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/fiscal-years/${YEAR}/reserve` && r.method === 'PATCH');
      expect(req.request.body).toEqual({
        reserveMode: 'receipt_share', reserveSharePct: 9.1,
        reserveAllocationRule: null, reserveAllocationValue: null,
      });
      req.flush(fiscalYear({ reserveSharePct: '9.10' }));
      await settle();
      const def = h.http.expectOne((r) => r.url === `${API}/estates/e1/accounting-settings` && r.method === 'PUT');
      expect(def.request.body).toEqual({
        defaultReserveMode: 'receipt_share', defaultReserveSharePct: 9.1,
        defaultReserveAllocationRule: null, defaultReserveAllocationValue: null,
      });
      def.flush(settings({ defaultReserveSharePct: '9.10' }));
      await save;
    });

    it('sin marcar "próximos ejercicios" no toca el valor por defecto', async () => {
      await mount();
      h.component.reserveAlsoDefault.set(false);
      h.component.reservePctDraft.set('10');
      const save = h.component.saveReserve();
      h.http.expectOne((r) => r.url.endsWith(`/fiscal-years/${YEAR}/reserve`)).flush(fiscalYear({ reserveSharePct: '10.00' }));
      await save;
      h.http.expectNone((r) => r.method === 'PUT');
    });

    it('rechaza porcentajes fuera de rango sin llamar al backend', async () => {
      await mount();
      h.component.reservePctDraft.set('120');
      await h.component.saveReserve();
      expect(h.component.reserveError()).toContain('de 0 a 100');
      h.http.expectNone((r) => r.method === 'PATCH');
    });

    it('con el ejercicio cerrado no se puede cambiar', async () => {
      await mount(settings(), undefined, [fiscalYear({ status: 'Cerrado' })]);
      expect(h.el.querySelector('#reserve-mode')).toBeNull();
      expect(h.el.textContent).toContain('está cerrado');
    });
  });

  describe('cuentas bancarias', () => {
    it('crea una cuenta con el IBAN normalizado', async () => {
      await mount();
      h.component.openNewBank();
      h.component.bAlias.set('Cuenta de obras');
      h.component.bIban.set('es91 2100 0418 4502 0005 1332');
      h.component.bReserve.set(true);

      const submit = h.component.submitBank();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/bank-accounts` && r.method === 'POST');
      expect(req.request.body).toEqual({ alias: 'Cuenta de obras', iban: 'ES9121000418450200051332', isReserveAccount: true });
      req.flush([bank(), bank({ id: 'b3', alias: 'Cuenta de obras', isDefault: false })]);
      await submit;
      h.fixture.detectChanges();
      expect(h.component.showBankForm()).toBe(false);
      expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
    });

    it('un IBAN con forma inválida no se envía', async () => {
      await mount();
      h.component.openNewBank();
      h.component.bAlias.set('X');
      h.component.bIban.set('1234');
      await h.component.submitBank();
      expect(h.component.bErrors().iban).toBe(true);
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('al editar, un IBAN vacío no se envía (se conserva el guardado)', async () => {
      await mount();
      h.component.openEditBank({ ...bank({ id: 'b2', alias: 'Obras', isDefault: false }), balance: 0 } as never);
      h.component.bAlias.set('Obras 2027');
      const submit = h.component.submitBank();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/bank-accounts/b2` && r.method === 'PATCH');
      expect(req.request.body).not.toHaveProperty('iban');
      expect(req.request.body).toMatchObject({ alias: 'Obras 2027' });
      req.flush([bank()]);
      await submit;
    });

    it('cerrar una cuenta con saldo muestra el motivo del backend', async () => {
      await mount();
      const second = h.component.banks()[1];
      const close = h.component.toggleClosed(second);
      h.http
        .expectOne((r) => r.url === `${API}/estates/e1/bank-accounts/b2` && r.method === 'PATCH')
        .flush({ message: 'La cuenta tiene saldo (10.00 €): traspásalo antes de cerrarla.' }, { status: 422, statusText: 'Unprocessable' });
      await close;
      h.fixture.detectChanges();
      expect(h.el.querySelector('.action-error')?.textContent).toContain('traspásalo antes de cerrarla');
    });

    it('la cuenta por defecto no ofrece "Cerrar" ni "Usar por defecto"', async () => {
      await mount();
      const firstRow = h.el.querySelectorAll('tbody tr')[0];
      const labels = Array.from(firstRow.querySelectorAll('button')).map((b) => b.textContent?.trim());
      expect(labels).toEqual(['Editar']);
    });
  });
  describe('devoluciones bancarias', () => {
    it('activar la repercusión de comisiones la guarda y avisa', async () => {
      await mount();
      const box = h.el.querySelector<HTMLInputElement>('#return-fee-recharge')!;
      expect(box.checked).toBe(false);

      const save = h.component.setReturnFeeRecharge(true);
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/accounting-settings` && r.method === 'PUT');
      expect(req.request.body).toEqual({ returnFeeRecharge: true });
      req.flush(settings({ returnFeeRecharge: true }));
      await save;
      expect(h.component.settings()?.returnFeeRecharge).toBe(true);
      expect(h.component.toastMessage()).toContain('se repercutirán');
    });

    it('si falla, vuelve al valor anterior y muestra el motivo', async () => {
      await mount();
      const save = h.component.setReturnFeeRecharge(true);
      h.http.expectOne(`${API}/estates/e1/accounting-settings`).flush({ message: 'Sin permiso' }, { status: 403, statusText: 'Forbidden' });
      await save;
      expect(h.component.settings()?.returnFeeRecharge).toBe(false);
      expect(h.component.returnFeeError()).toBe('Sin permiso');
    });
  });

  describe('uso del fondo de reserva', () => {
    function application(overrides: Record<string, unknown> = {}) {
      return {
        id: 'ru1', date: '2026-03-15T00:00:00.000Z', amount: 1500, reason: 'reparacion',
        concept: 'Impermeabilización de cubierta', meetingReference: 'Acta junta 2026-03-01',
        relatedSupplierInvoiceNumber: null, relatedPayrollPeriod: null, entryNumber: 12,
        status: 'Vigente', cancelReason: null,
        ...overrides,
      };
    }

    it('sin liberaciones, muestra el mensaje vacío', async () => {
      await mount();
      expect(h.el.textContent).toContain('Sin liberaciones registradas');
    });

    it('lista las liberaciones con su motivo y estado', async () => {
      await mount(settings(), undefined, undefined, [
        application(),
        application({ id: 'ru2', status: 'Deshecha', reason: 'otro' }),
      ]);
      expect(h.el.textContent).toContain('Reparación');
      expect(h.el.textContent).toContain('Impermeabilización de cubierta');
      expect(h.el.textContent).toContain('Acta junta 2026-03-01');
      expect(h.el.textContent).toContain('1.500,00');
      expect(h.el.textContent).toContain('Deshecha');
    });

    it('exige un importe válido antes de mandar la petición', async () => {
      await mount();
      h.component.openReserveUseForm();
      h.component.ruAmount.set('0');
      h.component.ruConcept.set('Concepto válido');
      h.component.ruMeetingReference.set('Acta junta');
      await h.component.submitReserveUse();
      expect(h.component.ruError()).toContain('mayor que cero');
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('libera el fondo con motivo y acta, y recarga la lista', async () => {
      await mount();
      h.component.openReserveUseForm();
      h.component.ruDate.set('2026-03-15');
      h.component.ruAmount.set('1500');
      h.component.ruReason.set('reparacion');
      h.component.ruConcept.set('Impermeabilización de cubierta');
      h.component.ruMeetingReference.set('Acta junta 2026-03-01');
      const submit = h.component.submitReserveUse();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/reserve-fund-applications` && r.method === 'POST');
      expect(req.request.body).toEqual({
        date: '2026-03-15', amount: 1500, reason: 'reparacion',
        concept: 'Impermeabilización de cubierta', meetingReference: 'Acta junta 2026-03-01',
      });
      req.flush({});
      await settle();
      h.http.expectOne(`${API}/estates/e1/reserve-fund-applications`).flush([application()]);
      await submit;
      h.fixture.detectChanges();
      expect(h.component.showReserveUseForm()).toBe(false);
      expect(h.component.toastMessage()).toContain('registrada');
      expect(h.el.textContent).toContain('Impermeabilización de cubierta');
    });

    it('deshacer pide el motivo y recarga la lista', async () => {
      await mount(settings(), undefined, undefined, [application()]);
      h.component.openCancelReserveUse('ru1');

      const confirmFail = h.component.confirmCancelReserveUse();
      expect(h.component.ruCancelError()).toContain('motivo');
      await confirmFail;

      h.component.ruCancelReason.set('Importe equivocado');
      const confirm = h.component.confirmCancelReserveUse();
      const req = h.http.expectOne((r) => r.url === `${API}/reserve-fund-applications/ru1/cancel` && r.method === 'POST');
      expect(req.request.body).toEqual({ reason: 'Importe equivocado' });
      req.flush({});
      await settle();
      h.http.expectOne(`${API}/estates/e1/reserve-fund-applications`).flush([application({ status: 'Deshecha' })]);
      await confirm;
      expect(h.component.cancellingReserveUseId()).toBeNull();
      expect(h.component.toastMessage()).toContain('deshecha');
    });
  });
});
