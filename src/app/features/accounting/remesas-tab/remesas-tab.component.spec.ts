import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { RemesasTabComponent } from './remesas-tab.component';
import type { AccountingEstate, RemesaHistoryItem, RemesaLine } from '../../../core/models';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
}

function makeRemesa(overrides: Partial<RemesaHistoryItem> = {}): RemesaHistoryItem {
  return {
    id: 'R-2026-01', period: 'Marzo 2026', periodKey: '2026-03', scheme: 'CORE', count: 10, amount: 1000,
    presented: '2026-03-01', charge: '2026-03-05', status: 'Cobrada', charged: 9, returned: 1, pending: 0, returnedAmount: 100,
    ...overrides,
  };
}

/** SepaService.listRemesas() mapea desde un shape crudo distinto (period anidado, linesCount/totalAmount…) — esto es lo que hay que flushear en el GET. */
function makeRawRemesa(item: RemesaHistoryItem): any {
  return {
    id: item.id,
    period: { label: item.period, periodKey: item.periodKey },
    scheme: item.scheme,
    linesCount: item.count,
    totalAmount: item.amount,
    presentedAt: item.presented,
    chargeDate: item.charge,
    status: item.status,
    charged: item.charged,
    returned: item.returned,
    pending: item.pending,
    returnedAmount: item.returnedAmount,
  };
}

function makeLine(overrides: Partial<RemesaLine> = {}): RemesaLine {
  return { id: 'l1', owner: 'Ana García', unit: 'Piso 3A', iban: 'ES1234', mandate: 'M001', seq: 'RCUR', amount: 100, status: 'Cobrado', ...overrides };
}

describe('RemesasTabComponent', () => {
  let h: ComponentHarness<RemesasTabComponent>;

  beforeEach(() => {
    h = setupComponent(RemesasTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  function flushInitialLoad(history: RemesaHistoryItem[]): void {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/remesas`).flush(history.map(makeRawRemesa));
  }

  it('carga el historial al montar y refleja los KPIs', async () => {
    flushInitialLoad([
      makeRemesa({ id: 'R1', amount: 1000, count: 10, returned: 1 }),
      makeRemesa({ id: 'R2', amount: 500, count: 5, returned: 0 }),
    ]);
    await settle();
    h.fixture.detectChanges();

    expect(h.component.remesasCount()).toBe(2);
    expect(h.component.totalDomiciliado()).toBe(1500);
    expect(h.component.returnRate()).toBeCloseTo((1 / 15) * 100, 1);
    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('abrir una remesa carga sus líneas y muestra el detalle', async () => {
    flushInitialLoad([makeRemesa({ id: 'R1' })]);
    await settle();
    h.fixture.detectChanges();

    (h.el.querySelector('tbody tr') as HTMLElement).click();
    h.http.expectOne((r) => r.url === `${API}/remesas/R1/lines`).flush([makeLine()]);
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelector('.detail')).not.toBeNull();
    expect(h.el.querySelectorAll('.line-name')).toHaveLength(1);

    (h.el.querySelector('.back-link') as HTMLElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.detail')).toBeNull();
  });

  describe('descargar / ver el fichero SEPA (nunca se regenera)', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    });

    it('descargar XML pide el mismo fichero ya presentado', async () => {
      flushInitialLoad([makeRemesa({ id: 'R1' })]);
      await settle();
      h.fixture.detectChanges();
      const openPromise = h.component.open(makeRemesa({ id: 'R1' }));
      h.http.expectOne((r) => r.url === `${API}/remesas/R1/lines`).flush([]);
      await openPromise;

      const promise = h.component.downloadXml();
      const req = h.http.expectOne((r) => r.url === `${API}/remesas/R1/file`);
      req.flush('<xml>contenido</xml>');
      await promise;

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });

    it('"Ver justificante" abre el mismo fichero en una pestaña nueva en vez de descargarlo', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      flushInitialLoad([makeRemesa({ id: 'R1' })]);
      await settle();
      h.fixture.detectChanges();
      const openPromise = h.component.open(makeRemesa({ id: 'R1' }));
      h.http.expectOne((r) => r.url === `${API}/remesas/R1/lines`).flush([]);
      await openPromise;

      const promise = h.component.viewJustificante();
      const req = h.http.expectOne((r) => r.url === `${API}/remesas/R1/file`);
      req.flush('<xml>contenido</xml>');
      await promise;

      expect(openSpy).toHaveBeenCalledWith('blob:fake-url', '_blank');
    });
  });

  describe('cierre del wizard de nueva remesa', () => {
    it('si se generó una remesa, recarga el historial y avisa por toast', async () => {
      flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      const promise = h.component.onWizardClosed({ generated: true });
      h.http.expectOne((r) => r.url === `${API}/estates/e1/remesas`).flush([makeRemesa({ id: 'R-nueva' })].map(makeRawRemesa));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.showWizard()).toBe(false);
      expect(h.el.querySelector('.toast')?.textContent).toContain('Remesa generada correctamente');
    });

    it('si se canceló sin generar, solo cierra el wizard sin recargar nada', async () => {
      flushInitialLoad([]);
      await settle();
      h.fixture.detectChanges();

      await h.component.onWizardClosed({ generated: false });

      expect(h.component.showWizard()).toBe(false);
      h.http.expectNone((r) => r.url === `${API}/estates/e1/remesas`);
    });
  });
  describe('cobro, anulación y devoluciones', () => {
    async function openRemesa(remesa: RemesaHistoryItem, lines: RemesaLine[]): Promise<void> {
      flushInitialLoad([remesa]);
      await settle();
      const open = h.component.open(h.component.history()[0]);
      h.http.expectOne(`${API}/remesas/${remesa.id}/lines`).flush(lines);
      await open;
      h.fixture.detectChanges();
    }

    function flushReload(remesa: RemesaHistoryItem): void {
      h.http.expectOne((r) => r.url === `${API}/estates/e1/remesas`).flush([makeRawRemesa(remesa)]);
    }

    it('una remesa presentada se marca como cobrada con la fecha del abono', async () => {
      const remesa = makeRemesa({ id: 'R1', status: 'Presentada', charged: 0, returned: 0, returnedAmount: 0 });
      await openRemesa(remesa, [makeLine({ status: 'Pendiente' })]);
      expect(h.el.textContent).toContain('Marcar como cobrada');

      h.component.openCollect();
      expect(h.component.collectDate()).toBe('2026-03-05');
      const confirm = h.component.confirmCollect();
      const req = h.http.expectOne(`${API}/remesas/R1/collect`);
      expect(req.request.body).toEqual({ date: '2026-03-05' });
      req.flush({});
      await settle();
      flushReload({ ...remesa, status: 'Cobrada' });
      await settle();
      h.http.expectOne(`${API}/remesas/R1/lines`).flush([makeLine({ status: 'Cobrado' })]);
      await confirm;
      h.fixture.detectChanges();

      expect(h.component.selected()?.status).toBe('Cobrada');
      expect(h.component.canCollect()).toBe(false);
      expect(h.component.toastMessage()).toContain('Remesa cobrada');
    });

    it('si el backend rechaza el cobro, se muestra el motivo', async () => {
      const remesa = makeRemesa({ id: 'R1', status: 'Presentada' });
      await openRemesa(remesa, [makeLine({ status: 'Pendiente' })]);
      h.component.openCollect();
      const confirm = h.component.confirmCollect();
      h.http.expectOne(`${API}/remesas/R1/collect`).flush({ message: 'Estos recibos ya no deben el importe de la remesa' }, { status: 409, statusText: 'Conflict' });
      await confirm;
      expect(h.component.actionError()).toContain('ya no deben');
      expect(h.component.collectOpen()).toBe(true);
    });

    it('anular una remesa presentada', async () => {
      const remesa = makeRemesa({ id: 'R1', status: 'Presentada' });
      await openRemesa(remesa, [makeLine({ status: 'Pendiente' })]);
      h.component.openCancelRemesa();
      const confirm = h.component.confirmCancelRemesa();
      h.http.expectOne((r) => r.url === `${API}/remesas/R1/cancel` && r.method === 'POST').flush({});
      await settle();
      flushReload({ ...remesa, status: 'Anulada' });
      await settle();
      h.http.expectOne(`${API}/remesas/R1/lines`).flush([makeLine({ status: 'Pendiente' })]);
      await confirm;
      expect(h.component.selected()?.status).toBe('Anulada');
      expect(h.component.canCollect()).toBe(false);
    });

    it('devolver una línea cobrada manda motivo, fecha y comisión', async () => {
      const remesa = makeRemesa({ id: 'R1', status: 'Cobrada' });
      await openRemesa(remesa, [makeLine({ id: 'l1', status: 'Cobrado' })]);
      expect(h.component.canReturnLine(h.component.lines()[0])).toBe(true);
      expect(h.el.textContent).toContain('Registrar devolución');

      h.component.openReturn(h.component.lines()[0]);
      expect(h.component.returnIsRejection()).toBe(false);
      h.component.returnForm = { returnCode: 'MD06', returnReason: '', date: '2026-03-10', feeAmount: '2,50', rechargeFee: true };
      const confirm = h.component.confirmReturn();
      const req = h.http.expectOne((r) => r.url === `${API}/remesa-lines/l1/return` && r.method === 'PATCH');
      expect(req.request.body).toEqual({
        returnCode: 'MD06', returnReason: 'Devolución solicitada por el deudor', date: '2026-03-10', feeAmount: 2.5, rechargeFee: true,
      });
      req.flush({});
      await settle();
      flushReload({ ...remesa, status: 'Con devoluciones' });
      await settle();
      h.http.expectOne(`${API}/remesas/R1/lines`).flush([makeLine({ id: 'l1', status: 'Devuelto', returnCode: 'MD06' })]);
      await confirm;
      expect(h.component.returningLine()).toBeNull();
      expect(h.component.toastMessage()).toContain('Devolución registrada');
    });

    it('una línea sin cobrar de una remesa presentada se marca rechazada, sin comisión', async () => {
      const remesa = makeRemesa({ id: 'R1', status: 'Presentada' });
      await openRemesa(remesa, [makeLine({ id: 'l1', status: 'Pendiente' })]);
      h.component.openReturn(h.component.lines()[0]);
      expect(h.component.returnIsRejection()).toBe(true);
      h.component.returnForm = { returnCode: 'AC04', returnReason: 'Cuenta cerrada', date: '2026-03-04', feeAmount: '3', rechargeFee: true };
      const confirm = h.component.confirmReturn();
      const req = h.http.expectOne(`${API}/remesa-lines/l1/return`);
      expect(req.request.body).toEqual({ returnCode: 'AC04', returnReason: 'Cuenta cerrada', date: '2026-03-04' });
      req.flush({});
      await settle();
      flushReload(remesa);
      await settle();
      h.http.expectOne(`${API}/remesas/R1/lines`).flush([makeLine({ id: 'l1', status: 'Rechazado' })]);
      await confirm;
      expect(h.component.toastMessage()).toContain('rechazada');
    });

    it('una línea ya devuelta no se vuelve a devolver', async () => {
      const remesa = makeRemesa({ id: 'R1', status: 'Con devoluciones' });
      await openRemesa(remesa, [makeLine({ status: 'Devuelto' }), makeLine({ id: 'l2', status: 'Rechazado' })]);
      expect(h.component.lines().some((l) => h.component.canReturnLine(l))).toBe(false);
    });
  });
  describe('importar devoluciones del banco', () => {
    it('al cerrar tras contabilizar, recarga el historial; sin cambios, no recarga nada', async () => {
      flushInitialLoad([makeRemesa({ id: 'R1', status: 'Cobrada' })]);
      await settle();
      h.component.showReturnsImport.set(true);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/estates/e1/return-files`).flush([]);
      await settle();
      expect(h.el.querySelector('app-importar-devoluciones')).toBeTruthy();

      await h.component.onReturnsImportClosed({ changed: false });
      h.http.expectNone(`${API}/estates/e1/remesas`);

      const reload = h.component.onReturnsImportClosed({ changed: true });
      h.http.expectOne(`${API}/estates/e1/remesas`).flush([makeRawRemesa(makeRemesa({ id: 'R1', status: 'Con devoluciones' }))]);
      await reload;
      expect(h.component.showReturnsImport()).toBe(false);
      expect(h.component.history()[0].status).toBe('Con devoluciones');
      expect(h.component.toastMessage()).toContain('Devoluciones del banco');
    });
  });
});
