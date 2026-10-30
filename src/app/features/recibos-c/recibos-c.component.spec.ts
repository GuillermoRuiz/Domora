import { signal } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { OwnerScopeService, type ScopeGroup, type ScopeProperty } from '../../core/owner-scope.service';
import { RecibosCComponent, receiptPending } from './recibos-c.component';

registerLocaleData(localeEs);

const P1: ScopeProperty = { id: 'p1', nickname: '3A', addressFull: 'Calle Colón 24', estateId: 'e1', estateName: 'Colón 24', isLinked: true, estateIban: 'ES11' };
const P2: ScopeProperty = { id: 'p2', nickname: '1A', addressFull: 'Calle Cuba 18', estateId: 'e2', estateName: 'Cuba 18', isLinked: true, estateIban: 'ES22' };
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

/** Recibo tal como lo devuelve `/users/:id/receipts`. */
function apiReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1', no: 'REC-001', periodKey: '2026-06', period: 'Junio 2026', propertyId: 'p1', amount: '120', concept: 'Cuota',
    kind: 'ordinaria', status: 'Pendiente', date: '2026-06-01', dueDate: '2026-06-10', proofFileName: null,
    ...overrides,
  };
}

/** A scope service the test controls (the real one has its own tests). */
function fakeScope(items: ScopeProperty[], opts: { selectedId?: string | null } = {}) {
  const selectedId = signal<string | null>(opts.selectedId !== undefined ? opts.selectedId : items[0]?.id ?? null);
  const showAll = () => items.length > 1;
  const isAll = () => showAll() && !items.some((p) => p.id === selectedId());
  const groups = (): ScopeGroup[] => items.map((p) => ({ estateId: p.estateId, estateName: p.estateName ?? 'Sin comunidad vinculada', properties: [p] }));
  return {
    items: signal(items),
    loaded: signal(true),
    failed: signal(false),
    showAll,
    isAll,
    selected: () => (isAll() ? null : items.find((p) => p.id === selectedId()) ?? null),
    groups,
    load: vi.fn(async () => undefined),
    select: vi.fn((id: string | null) => selectedId.set(id)),
  };
}

describe('RecibosCComponent', () => {
  let h: ComponentHarness<RecibosCComponent>;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function mount(scope = fakeScope([P1, P2], { selectedId: 'p1' }), query: Record<string, string> = {}, receipts = [apiReceipt()]) {
    const params = new BehaviorSubject<ParamMap>(convertToParamMap(query));
    // The query params are read as the component is created: spy before mounting.
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    h = setupComponent(RecibosCComponent, {
      user: makeUser({ id: 'u1' }),
      providers: [
        { provide: OwnerScopeService, useValue: scope },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params.value }, queryParamMap: params } },
      ],
    });
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/users/u1/receipts`).flush(receipts);
    await settle();
    h.fixture.detectChanges();
    return scope;
  }

  afterEach(() => {
    h?.http.verify();
    navigate?.mockRestore();
  });

  it('shows the receipts of the selected property with the pending total', async () => {
    await mount(undefined, {}, [
      apiReceipt({ id: 'r1', status: 'Pendiente', amount: '45' }),
      apiReceipt({ id: 'r2', status: 'Pagada', amount: '120' }),
      apiReceipt({ id: 'r3', propertyId: 'p2', status: 'Pendiente', amount: '30' }),
    ]);

    expect(text(h.el.querySelector('h1'))).toBe('Recibos y pagos');
    expect(text(h.el.querySelector('[data-scope-chip]'))).toBe('Ámbito actual: 3A');
    expect(Array.from(h.el.querySelectorAll('tbody tr')).map((r) => r.getAttribute('data-receipt')).sort()).toEqual(['r1', 'r2']);
    expect(text(h.el.querySelector('[data-pending-total]'))).toContain('45,00');
    expect(text(h.el.querySelector('[data-pending-total]'))).toContain('1 recibo pendiente');
  });

  it('«Todas mis propiedades» lists every receipt with its property and hides the property reports', async () => {
    await mount(fakeScope([P1, P2], { selectedId: null }), {}, [apiReceipt({ id: 'r1' }), apiReceipt({ id: 'r3', propertyId: 'p2' })]);

    expect(h.el.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(text(h.el.querySelector('thead'))).toContain('Propiedad');
    expect(text(h.el.querySelector('[data-receipt="r3"]'))).toContain('1A');
    expect(h.el.querySelector('.reports-card')).toBeNull();
  });

  it('?propertyId= selects that property and drops the param; ?receipt= highlights the receipt', async () => {
    const scope = await mount(fakeScope([P1, P2], { selectedId: 'p1' }), { propertyId: 'p2', receipt: 'r3' }, [apiReceipt({ id: 'r3', propertyId: 'p2' })]);

    expect(scope.select).toHaveBeenCalledWith('p2');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { propertyId: null }, replaceUrl: true }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-receipt="r3"]')?.classList.contains('row--highlight')).toBe(true);
  });

  it('«Pagar» opens the transfer instructions with the IBAN of the receipt community', async () => {
    await mount(fakeScope([P1, P2], { selectedId: null }), {}, [apiReceipt({ id: 'r3', propertyId: 'p2', amount: '30', outstanding: '20', status: 'Parcial' })]);

    (Array.from(h.el.querySelectorAll('.receipt-actions button')).find((b) => text(b) === 'Pagar') as HTMLElement).click();
    h.fixture.detectChanges();

    expect(h.component.payTarget()).toEqual({ amount: 20, concept: 'Recibo · Junio 2026', iban: 'ES22', estateName: 'Cuba 18' });
    expect(h.el.querySelector('app-transfer-instructions-modal')).not.toBeNull();
    h.component.closePay();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-transfer-instructions-modal')).toBeNull();
  });

  it('a cancelled receipt has no payment actions', async () => {
    await mount(undefined, {}, [apiReceipt({ id: 'r1', status: 'Anulado' })]);
    expect(h.el.querySelector('.receipt-actions button')).toBeNull();
  });

  it('attaching a proof uploads it and updates the receipt; a failure shows an error', async () => {
    await mount();
    const input = { click: vi.fn() } as unknown as HTMLInputElement;

    h.component.triggerAttachProof('r1', input);
    const ok = h.component.onProofFileChange({ target: { files: [new File(['x'], 'comprobante.pdf')], value: '' } } as unknown as Event);
    const req = h.http.expectOne((r) => r.url === `${API}/receipts/r1/payment-proof` && r.method === 'POST');
    expect(req.request.body instanceof FormData).toBe(true);
    req.flush(apiReceipt({ proofFileName: 'comprobante.pdf' }));
    await ok;
    h.fixture.detectChanges();
    expect(h.component.toastMessage()).toContain('Justificante adjuntado correctamente');
    expect(Array.from(h.el.querySelectorAll('.receipt-actions button')).some((b) => text(b) === 'Ver justificante')).toBe(true);

    h.component.triggerAttachProof('r1', input);
    const failed = h.component.onProofFileChange({ target: { files: [new File(['x'], 'otro.pdf')], value: '' } } as unknown as Event);
    h.http.expectOne((r) => r.url === `${API}/receipts/r1/payment-proof`).flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
    await failed;
    expect(h.component.toastMessage()).toContain('No se pudo adjuntar el justificante');
  });

  it('downloads the proof of a paid receipt, the statement and the debt certificate of the selected property', async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:fake-url');
    URL.revokeObjectURL = vi.fn();
    try {
      await mount(undefined, {}, [apiReceipt({ id: 'r1', status: 'Pagada', proofFileName: 'justificante.pdf' })]);

      (Array.from(h.el.querySelectorAll('.receipt-actions button')).find((b) => text(b) === 'Descargar') as HTMLElement).click();
      h.http.expectOne(`${API}/receipts/r1/payment-proof/file`).flush(new Blob(['x']));
      await settle();

      (Array.from(h.el.querySelectorAll('.reports-card button')).find((b) => text(b) === 'PDF') as HTMLElement).click();
      const statement = h.http.expectOne((r) => r.url === `${API}/properties/p1/ledger-extract?format=pdf`);
      expect(statement.request.responseType).toBe('blob');
      statement.flush(new Blob(['%PDF']));
      await settle();

      const certificate = h.component.downloadDebtCertificate();
      h.http.expectOne(`${API}/properties/p1/debt-certificate.pdf`).flush(new Blob(['%PDF']));
      await certificate;

      expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it('without properties it invites to add one', async () => {
    await mount(fakeScope([]), {}, []);
    expect(text(h.el.querySelector('app-empty-state'))).toContain('Aún no tienes propiedades');
  });

  it('receiptPending only counts what is still owed', () => {
    expect(receiptPending({ status: 'Pendiente', amount: 10 } as never)).toBe(10);
    expect(receiptPending({ status: 'Parcial', amount: 10, outstanding: 4 } as never)).toBe(4);
    expect(receiptPending({ status: 'Pagada', amount: 10 } as never)).toBe(0);
    expect(receiptPending({ status: 'Anulado', amount: 10 } as never)).toBe(0);
  });
});
