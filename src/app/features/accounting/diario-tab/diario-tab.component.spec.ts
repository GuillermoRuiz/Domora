import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { DiarioTabComponent } from './diario-tab.component';

function rawEntry(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'j1', fiscalYear: 2026, number: 3, date: '2026-03-01T00:00:00.000Z', entryType: 'standard',
    sourceType: 'manual', sourceLabel: 'Asiento manual', concept: 'Ajuste', reference: null,
    reverses: null, reversedBy: null, canReverse: true, attachments: [], total: 50,
    lines: [
      { lineNo: 1, accountId: 'a622', accountCode: '622', accountName: 'Reparaciones', debit: 50, credit: 0, concept: null,
        property: null, supplier: null, costCentre: 'Piscina', receiptNo: null, invoiceNumber: null },
      { lineNo: 2, accountId: 'a570', accountCode: '570', accountName: 'Caja', debit: 0, credit: 50, concept: null,
        property: null, supplier: null, costCentre: null, receiptNo: null, invoiceNumber: null },
    ],
    ...overrides,
  };
}

describe('DiarioTabComponent', () => {
  let h: ComponentHarness<DiarioTabComponent>;

  beforeEach(() => {
    h = setupComponent(DiarioTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function mount(items: any[] = [rawEntry()], total = items.length) {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([{ id: 'a622', estateId: 'e1', code: '622', name: 'Reparaciones', postable: true }]);
    h.http.expectOne(`${API}/estates/e1/cost-centres`).flush([]);
    await flushList(items, total);
  }

  async function flushList(items: any[] = [rawEntry()], total = items.length) {
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/journal`);
    req.flush({ total, page: Number(req.request.params.get('page')), pageSize: 50, items });
    await settle();
    h.fixture.detectChanges();
    return req;
  }

  it('lista los asientos y al abrir uno enseña sus líneas con sus datos', async () => {
    await mount();
    expect(h.el.textContent).toContain('2026/3');
    expect(h.el.textContent).toContain('Asiento manual');
    h.component.toggle('j1');
    h.fixture.detectChanges();
    const detail = h.el.querySelector('.detail-row')!;
    expect(detail.textContent).toContain('622');
    expect(detail.textContent).toContain('Centro Piscina');
    expect(detail.textContent).toContain('Anular');
  });

  it('filtra por fechas, origen, cuenta y concepto, volviendo a la primera página', async () => {
    await mount([rawEntry()], 120);
    expect(h.component.pages()).toBe(3);
    const next = h.component.goTo(2);
    expect((await flushList()).request.params.get('page')).toBe('2');
    await next;

    h.component.filters = { from: '2026-01-01', to: '2026-03-31', sourceType: 'treasury', accountId: 'a622', q: 'luz' };
    const search = h.component.search();
    const req = await flushList();
    await search;
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('from')).toBe('2026-01-01');
    expect(req.request.params.get('sourceType')).toBe('treasury');
    expect(req.request.params.get('accountId')).toBe('a622');
    expect(req.request.params.get('q')).toBe('luz');
  });

  it('anular pide el motivo y registra el contraasiento', async () => {
    await mount();
    const [entry] = h.component.entries();
    h.component.openReverse(entry);
    await h.component.confirmReverse();
    expect(h.component.reverseError()).toContain('motivo');

    h.component.reverseForm.reason = 'Cuenta equivocada';
    const done = h.component.confirmReverse();
    const req = h.http.expectOne(`${API}/journal/j1/reverse`);
    expect(req.request.body).toEqual({ reason: 'Cuenta equivocada', date: h.component.reverseForm.date });
    req.flush({});
    await settle();
    await flushList([rawEntry({ canReverse: false, reversedBy: { id: 'j2', number: 4, fiscalYear: 2026 } })]);
    await done;
    expect(h.component.reversing()).toBeNull();
    expect(h.el.textContent).toContain('Anulado por 2026/4');
  });

  it('los asientos que nacen de un documento no se anulan desde el diario', async () => {
    await mount([rawEntry({ sourceType: 'collection', sourceLabel: 'Cobro', canReverse: false })]);
    h.component.toggle('j1');
    h.fixture.detectChanges();
    expect(h.el.querySelector('.detail-row')!.textContent).not.toContain('Anular');
  });

  it('adjuntar un justificante refresca solo ese asiento', async () => {
    await mount();
    const input = { files: [new File(['%PDF'], 'factura.pdf')], value: 'factura.pdf' } as unknown as HTMLInputElement;
    const done = h.component.onAttachmentFile(h.component.entries()[0], { target: input } as unknown as Event);
    h.http.expectOne(`${API}/journal/j1/attachments`).flush({});
    await settle();
    h.http.expectOne(`${API}/journal/j1`).flush(rawEntry({ attachments: [{ id: 'f1', fileName: 'factura.pdf', mimeType: 'application/pdf', createdAt: '2026-03-02' }] }));
    await done;
    expect(h.component.entries()[0].attachments).toHaveLength(1);
  });

  it('tras registrar un asiento manual vuelve a la primera página del diario', async () => {
    await mount();
    h.component.showManual.set(true);
    const done = h.component.onManualSaved({ ...rawEntry(), number: 9, date: '2026-03-01' });
    expect(h.component.showManual()).toBe(false);
    await flushList();
    await done;
    expect(h.component.toastMessage()).toBe('Asiento 2026/9 registrado');
  });
});
