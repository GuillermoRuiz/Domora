import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { NuevaRemesaComponent } from './nueva-remesa.component';
import type { AccountingEstate, EstateSepaBilling, RemesaCandidate } from '../../../core/models';

const VALID_CID = 'ES85ZZZB1234567A';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
}

function makeSepaBilling(overrides: Partial<EstateSepaBilling> = {}): EstateSepaBilling {
  return { creditorId: VALID_CID, creditorIbanMasked: 'ES91 •••• 1332', creditorBic: 'CAIXESBB', creditorPostalAddress: 'Calle Mayor 1', ...overrides };
}

function makeCandidate(overrides: Partial<RemesaCandidate> = {}): RemesaCandidate {
  return { id: 'c1', owner: 'Ana García', unit: 'Piso 3A', iban: 'ES1234', mandate: true, seq: 'RCUR', amount: 100, ...overrides };
}

/** SepaService.listRemesaCandidates() reescribe `id` a partir de `receiptId` crudo — hay que flushear ese shape, no el final. */
function makeRawCandidate(item: RemesaCandidate): any {
  return { receiptId: item.id, owner: item.owner, unit: item.unit, iban: item.iban, mandate: item.mandate, seq: item.seq, amount: item.amount, isNew: item.isNew };
}

/** `YYYY-MM-DD` en hora local (con `toISOString` sería UTC y el test fallaría de madrugada). */
function localIso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function tomorrowIso(): string {
  return localIso(1);
}

async function flushInitialLoad(http: any, opts: { billing?: EstateSepaBilling; periods?: { key: string; label: string }[]; candidates?: RemesaCandidate[] } = {}): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/estates/e1/sepa-billing`).flush(opts.billing ?? makeSepaBilling());
  const periods = opts.periods ?? [{ key: '2026-03', label: 'Marzo 2026' }];
  http.expectOne((r: any) => r.url === `${API}/estates/e1/accounting/periods`).flush(periods.map((p) => ({ periodKey: p.key, label: p.label })));
  await settle();
  if (periods[0]) {
    http.expectOne((r: any) => r.url === `${API}/estates/e1/remesas/candidates` && r.params.get('periodKey') === periods[0].key).flush((opts.candidates ?? [makeCandidate()]).map(makeRawCandidate));
    await settle();
  }
}

describe('NuevaRemesaComponent', () => {
  let h: ComponentHarness<NuevaRemesaComponent>;

  beforeEach(() => {
    h = setupComponent(NuevaRemesaComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  it('al montar, preselecciona el primer periodo y carga sus candidatos automáticamente', async () => {
    h.fixture.detectChanges();
    await flushInitialLoad(h.http, { candidates: [makeCandidate({ id: 'c1' }), makeCandidate({ id: 'c2', mandate: false })] });
    h.fixture.detectChanges();

    expect(h.component.cfgPeriod()).toBe('2026-03');
    expect(h.component.eligible()).toHaveLength(1); // solo cuenta el que tiene mandato
    expect(h.component.noMandate()).toHaveLength(1);
    expect(h.component.eligibleIds()).toEqual(['c1']); // seleccionados por defecto: los elegibles
  });

  it('cambiar de periodo recarga los candidatos de ese periodo', async () => {
    h.fixture.detectChanges();
    await flushInitialLoad(h.http, { periods: [{ key: '2026-03', label: 'Marzo' }, { key: '2026-04', label: 'Abril' }] });
    h.fixture.detectChanges();

    h.component.cfgPeriod.set('2026-04');
    const promise = h.component.onPeriodChange();
    h.http.expectOne((r: any) => r.url === `${API}/estates/e1/remesas/candidates` && r.params.get('periodKey') === '2026-04').flush([makeCandidate({ id: 'c-abril' })].map(makeRawCandidate));
    await promise;

    expect(h.component.allCandidates().map((c) => c.id)).toEqual(['c-abril']);
  });

  describe('selección de candidatos', () => {
    it('toggle/selectAll/selectNone solo afectan a los candidatos con mandato', async () => {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { candidates: [makeCandidate({ id: 'c1', mandate: true }), makeCandidate({ id: 'c2', mandate: false })] });
      h.fixture.detectChanges();

      h.component.selectNone();
      expect(h.component.eligibleIds()).toEqual([]);

      h.component.selectAll();
      expect(h.component.eligibleIds()).toEqual(['c1']); // c2 nunca se incluye, sin mandato

      h.component.toggle('c1');
      expect(h.component.isSelected('c1')).toBe(false);
    });
  });

  describe('validaciones SEPA antes de generar', () => {
    it('chargeDateIsValid exige al menos un día natural de margen', async () => {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();

      h.component.cfgChargeDate.set(localIso(0)); // hoy
      expect(h.component.chargeDateIsValid).toBe(false);

      h.component.cfgChargeDate.set(tomorrowIso());
      expect(h.component.chargeDateIsValid).toBe(true);
    });

    it('creditorIdIsValid rechaza un CID mal formado o con dígito de control incorrecto', async () => {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { billing: makeSepaBilling({ creditorId: 'ES00ZZZB1234567A' }) }); // check digit incorrecto
      h.fixture.detectChanges();

      expect(h.component.creditorIdIsValid).toBe(false);
    });

    it('canGenerate exige CID válido + fecha de cargo válida + al menos un candidato elegido', async () => {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { billing: makeSepaBilling({ creditorId: VALID_CID }), candidates: [makeCandidate({ id: 'c1', mandate: true })] });
      h.fixture.detectChanges();

      expect(h.component.canGenerate).toBe(false); // sin fecha de cargo todavía
      h.component.cfgChargeDate.set(tomorrowIso());
      expect(h.component.canGenerate).toBe(true);

      h.component.selectNone();
      expect(h.component.canGenerate).toBe(false); // sin candidatos elegidos
    });
  });

  it('excludedIds lista los candidatos elegibles que el usuario deseleccionó manualmente', async () => {
    h.fixture.detectChanges();
    await flushInitialLoad(h.http, { candidates: [makeCandidate({ id: 'c1' }), makeCandidate({ id: 'c2' })] });
    h.fixture.detectChanges();

    h.component.toggle('c2'); // estaba seleccionado por defecto, lo excluye

    expect(h.component.excludedIds()).toEqual(['c2']);
  });

  describe('generar la remesa', () => {
    it('con todo válido, genera la remesa excluyendo los deseleccionados y pasa a la pantalla de éxito', async () => {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { candidates: [makeCandidate({ id: 'c1' }), makeCandidate({ id: 'c2' })] });
      h.fixture.detectChanges();
      h.component.cfgChargeDate.set(tomorrowIso());
      h.component.toggle('c2'); // excluir manualmente

      const promise = h.component.generate();
      const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/remesas` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ periodKey: '2026-03', excludeReceiptIds: ['c2'] });
      req.flush({ id: 'R-2026-03-01' });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.step()).toBe(4);
      expect(h.component.remesaRef()).toBe('R-2026-03-01');
      expect(h.el.textContent).toContain('Remesa generada correctamente');
    });

    it('si falla, muestra el error y se queda en el paso de confirmación', async () => {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http);
      h.fixture.detectChanges();
      h.component.cfgChargeDate.set(tomorrowIso());

      const promise = h.component.generate();
      const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/remesas` && r.method === 'POST');
      req.flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.step()).not.toBe(4);
      expect(h.el.textContent).toContain('No se pudo generar la remesa');
    });
  });

  it('close() emite el estado real de generated — false si se cancela, true si ya se generó', async () => {
    h.fixture.detectChanges();
    await flushInitialLoad(h.http);
    h.fixture.detectChanges();
    const emitted: { generated: boolean }[] = [];
    h.component.closed.subscribe((e) => emitted.push(e));

    h.component.close();
    expect(emitted).toEqual([{ generated: false }]);

    h.component.generated.set(true);
    h.component.close();
    expect(emitted).toEqual([{ generated: false }, { generated: true }]);
  });

  describe('descargar el XML tras generar (nunca se regenera)', () => {
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

    it('pide el mismo fichero ya persistido por el backend', async () => {
      h.fixture.detectChanges();
      await flushInitialLoad(h.http, { candidates: [makeCandidate({ id: 'c1' })] });
      h.fixture.detectChanges();
      h.component.cfgChargeDate.set(tomorrowIso());
      const genPromise = h.component.generate();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/remesas` && r.method === 'POST').flush({ id: 'R1' });
      await genPromise;

      const promise = h.component.downloadXml();
      const req = h.http.expectOne((r: any) => r.url === `${API}/remesas/R1/file`);
      req.flush('<xml>contenido</xml>');
      await promise;

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });
  });
});
