import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { ImportarDevolucionesComponent } from './importar-devoluciones.component';

function rawFile(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'f1', format: 'camt054', fileName: 'devoluciones-marzo.xml', createdAt: '2026-03-12T08:00:00.000Z', lastAppliedAt: null,
    counts: { matched: 1, unmatched: 1, applied: 0, already_returned: 0, failed: 0 },
    items: [
      {
        id: 'i1', seq: 1, endToEndId: 'REM-1-0001', amount: '100.00', date: '2026-03-12T00:00:00.000Z', returnCode: 'AM04',
        returnReason: 'Fondos insuficientes', feeAmount: '2.50', status: 'matched', error: null,
        remesaLine: {
          id: 'l1', status: 'Cobrado', amount: '100.00', ownerNameSnapshot: 'Ana García',
          receipt: { id: 'r1', no: '2026/03-001' }, property: { ref: null, staircase: '1', floor: '2', door: 'A' },
          remesa: { id: 'R1', concept: 'Cuotas marzo', status: 'Cobrada' },
        },
      },
      {
        id: 'i2', seq: 2, endToEndId: 'NO-EXISTE', amount: '50.00', date: '2026-03-12T00:00:00.000Z', returnCode: 'MD06',
        returnReason: 'Devolución solicitada por el deudor', feeAmount: null, status: 'unmatched',
        error: 'No se encuentra la línea de remesa de esta operación.', remesaLine: null,
      },
    ],
    ...overrides,
  };
}

describe('ImportarDevolucionesComponent', () => {
  let h: ComponentHarness<ImportarDevolucionesComponent>;

  beforeEach(() => {
    h = setupComponent(ImportarDevolucionesComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function mount(files: any[] = []): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates/e1/return-files`).flush(files);
    await settle();
    h.fixture.detectChanges();
  }

  async function upload(response: any): Promise<void> {
    const input = h.el.querySelector<HTMLInputElement>('#return-file-input')!;
    const file = new File(['<Document/>'], 'devoluciones-marzo.xml', { type: 'text/xml' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const done = h.component.onFileSelected({ target: input } as unknown as Event);
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/return-files` && r.method === 'POST');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush(response);
    await settle();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/return-files` && r.method === 'GET').flush([response]);
    await done;
    h.fixture.detectChanges();
  }

  it('sube el fichero y muestra cada devolución con su recibo antes de contabilizar', async () => {
    await mount();
    expect(h.el.textContent).toContain('Elegir fichero XML');
    await upload(rawFile());

    const file = h.component.current()!;
    expect(file.items[0].line).toEqual({
      id: 'l1', owner: 'Ana García', unit: '1-2-A', receiptNo: '2026/03-001', remesaConcept: 'Cuotas marzo', amount: 100,
    });
    expect(file.items[0].feeAmount).toBe(2.5);
    expect(h.el.textContent).toContain('Fondos insuficientes');
    expect(h.el.textContent).toContain('No se encuentra la línea');
    expect(h.el.textContent).toContain('Contabilizar 1 devolución(es)');
  });

  it('avisa si el fichero ya se había subido', async () => {
    await mount();
    await upload(rawFile({ duplicate: true }));
    expect(h.component.notice()).toContain('ya se había subido');
  });

  it('muestra el motivo si el fichero no es válido', async () => {
    await mount();
    const input = h.el.querySelector<HTMLInputElement>('#return-file-input')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'extracto.xml')], configurable: true });
    const done = h.component.onFileSelected({ target: input } as unknown as Event);
    h.http.expectOne(`${API}/estates/e1/return-files`).flush({ message: 'Es un extracto de cuenta (camt.053).' }, { status: 400, statusText: 'Bad Request' });
    await done;
    expect(h.component.error()).toContain('camt.053');
    expect(h.component.current()).toBeNull();
  });

  it('aplicar contabiliza, resume el resultado y al cerrar avisa de que hubo cambios', async () => {
    await mount();
    await upload(rawFile());
    const apply = h.component.apply();
    h.http.expectOne((r) => r.url === `${API}/return-files/f1/apply` && r.method === 'POST').flush(
      rawFile({
        lastAppliedAt: '2026-03-12T09:00:00.000Z',
        counts: { matched: 0, unmatched: 1, applied: 1, already_returned: 0, failed: 0 },
        summary: { applied: 1, alreadyReturned: 0, failed: 0 },
      }),
    );
    await settle();
    h.http.expectOne(`${API}/estates/e1/return-files`).flush([]);
    await apply;
    h.fixture.detectChanges();

    expect(h.component.notice()).toBe('1 devolución(es) contabilizada(s).');
    expect(h.component.toApply()).toBe(0);
    expect(h.el.textContent).toContain('Nada pendiente');

    const closed: { changed: boolean }[] = [];
    h.component.closed.subscribe((e) => closed.push(e));
    h.component.close();
    expect(closed).toEqual([{ changed: true }]);
  });

  it('abre un fichero anterior de la lista', async () => {
    await mount([rawFile({ items: [] })]);
    expect(h.el.textContent).toContain('Ficheros anteriores');
    (h.el.querySelector('.history__item') as HTMLButtonElement).click();
    h.http.expectOne(`${API}/return-files/f1`).flush(rawFile());
    await settle();
    expect(h.component.current()?.items).toHaveLength(2);
  });
});
