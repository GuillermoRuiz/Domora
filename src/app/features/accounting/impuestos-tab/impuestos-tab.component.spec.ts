import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { ImpuestosTabComponent } from './impuestos-tab.component';

const YEAR = new Date().getFullYear();
const QUARTER = Math.floor(new Date().getMonth() / 3) + 1;
const ESTATE = { name: 'Edificio Sol', cif: 'H1', address: 'Calle 1', location: 'Madrid' };

function m111(overrides: Record<string, unknown> = {}): any {
  return {
    estate: ESTATE, year: YEAR, quarter: QUARTER, period: `${YEAR}-T${QUARTER}`, from: `${YEAR}-01-01`, to: `${YEAR}-03-31`,
    deadline: `${YEAR}-04-20`,
    boxes: { '01': 1, '02': 1500, '03': 150, '07': 1, '08': 471.7, '09': 70.75, '28': 220.75 },
    unclassified: { recipients: 0, perceptions: 0, withholdings: 0 },
    settlements: [], settled: 0, pending: 220.75,
    detail: [{ date: `${YEAR}-03-01`, key: 'A', nif: null, name: 'Portero', documentRef: 'Nómina', source: 'payroll', perception: 1500, withholding: 150 }],
    ...overrides,
  };
}

describe('ImpuestosTabComponent', () => {
  let h: ComponentHarness<ImpuestosTabComponent>;

  beforeEach(() => {
    h = setupComponent(ImpuestosTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function mount(report = m111()) {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/bank-accounts`).flush([{ id: 'b1', alias: 'Principal', isDefault: true, closedAt: null, balance: 0 }]);
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/111`).flush(report);
    await settle();
    h.fixture.detectChanges();
  }

  it('muestra las casillas del 111, lo pendiente y avisa del NIF que falta', async () => {
    await mount();
    expect(h.el.textContent).toContain('Suma de retenciones');
    expect(h.el.textContent).toContain('220,75 €');
    expect(h.el.textContent).toContain('Falta NIF');
  });

  it('registrar el ingreso propone lo pendiente y lo manda con el trimestre', async () => {
    await mount();
    h.component.openSettle();
    expect(h.component.settleForm.amount).toBe('220,75');
    h.component.settleForm.reference = 'NRC123';
    const save = h.component.confirmSettle();
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/tax-settlements` && r.method === 'POST');
    expect(req.request.body).toEqual({
      kind: 'modelo111', period: `${YEAR}-T${QUARTER}`, date: expect.any(String), amount: 220.75, bankAccountId: 'b1', reference: 'NRC123',
    });
    req.flush({});
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/111`).flush(m111({ settled: 220.75, pending: 0, settlements: [{ id: 't1', date: `${YEAR}-04-15`, amount: 220.75, reference: 'NRC123' }] }));
    await save;
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('NRC123');

    h.component.openUndo('t1');
    await h.component.confirmUndo();
    expect(h.component.undoError()).toContain('motivo');
    h.component.undoReason.set('Importe equivocado');
    const undo = h.component.confirmUndo();
    h.http.expectOne(`${API}/tax-settlements/t1/undo`).flush({});
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/111`).flush(m111());
    await undo;
  });

  it('cambia al 190 y al 347 y muestra por qué no se declara un proveedor', async () => {
    await mount();
    const s190 = h.component.select('190');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/190`).flush({
      estate: ESTATE, year: YEAR, rows: [{ nif: 'B1', name: 'Arquitectos', key: 'G', subkey: '01', perceptions: 1000, withholdings: 150 }],
      totals: { recipients: 1, perceptions: 1000, withholdings: 150 }, missingNif: [],
    });
    await s190;
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('G · Profesionales');

    const s347 = h.component.select('347');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/tax/347`).flush({
      estate: ESTATE, year: YEAR, income: [], missingNif: [],
      purchases: [{ supplierId: 's1', name: 'Ascensores', nif: 'B2', total: 4840, quarters: [2420, 2420, 0, 0] }],
      excluded: [{ supplierId: 's2', name: 'Eléctrica', total: 4840, reason: 'art_33_5' }],
    });
    await s347;
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Ascensores');
    expect(h.el.textContent).toContain('art. 33.5 RGAT');
  });

  it('descarga el PDF del modelo del trimestre', async () => {
    await mount();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    try {
      const dl = h.component.download('pdf');
      h.http.expectOne(`${API}/estates/e1/tax/111?year=${YEAR}&format=pdf&quarter=${QUARTER}`).flush(new Blob(['%PDF']));
      await dl;
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
