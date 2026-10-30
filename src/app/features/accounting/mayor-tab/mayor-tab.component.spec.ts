import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { MayorTabComponent } from './mayor-tab.component';

describe('MayorTabComponent', () => {
  let h: ComponentHarness<MayorTabComponent>;

  beforeEach(() => {
    h = setupComponent(MayorTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function mount() {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([
      { id: 'a430', code: '430', name: 'Propietarios', label: '430 · Propietarios', postable: true, archivedAt: null },
      { id: 'a572', code: '572', name: 'Bancos', label: '572 · Bancos', postable: false, archivedAt: null },
    ]);
    h.http.expectOne(`${API}/estates/e1/properties`).flush([{ id: 'p1', ref: '1A' }]);
    h.http.expectOne(`${API}/estates/e1/suppliers`).flush([{ id: 's1', name: 'Ascensores SA' }]);
    await settle();
    h.fixture.detectChanges();
  }

  it('sin cuenta elegida no pide el mayor, y filtra las cuentas no contabilizables', async () => {
    await mount();
    expect(h.el.textContent).toContain('Elige una cuenta');
    expect(h.component.accounts().map((a) => a.code)).toEqual(['430']);
  });

  it('al elegir una cuenta pide el mayor con los filtros', async () => {
    await mount();
    const load = h.component.setAccountCode('430');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/general-ledger` && r.params.get('accountCode') === '430')
      .flush({
        estate: { name: 'Sol', cif: null }, account: { code: '430', name: 'Propietarios' },
        from: null, to: null, openingBalance: 0, closingBalance: 150,
        rows: [{ date: '2026-01-05', entryNumber: '2026/1', concept: 'Emisión cuota', sourceType: 'receipt_issue', debit: 150, credit: 0, balance: 150 }],
      });
    await load;
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Emisión cuota');
    expect(h.el.textContent).toContain('150,00 €');
  });

  it('descarga el mayor en Excel solo si hay cuenta elegida', async () => {
    await mount();
    const load = h.component.setAccountCode('430');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/reports/general-ledger`).flush({
      estate: { name: 'Sol', cif: null }, account: { code: '430', name: 'Propietarios' },
      from: null, to: null, openingBalance: 0, closingBalance: 0, rows: [],
    });
    await load;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    try {
      const dl = h.component.download('xlsx');
      h.http.expectOne(`${API}/estates/e1/reports/general-ledger?format=xlsx&accountCode=430`).flush(new Blob(['x']));
      await dl;
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
