import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { ChartAccount } from '../../../core/models';
import { AsientoManualDialogComponent } from './asiento-manual-dialog.component';

function account(id: string, code: string, extra: Partial<ChartAccount> = {}): ChartAccount {
  return { id, estateId: 'e1', code, name: `Cuenta ${code}`, postable: true, ...extra };
}

const ACCOUNTS: ChartAccount[] = [
  account('a681', '681', { name: 'Amortización' }),
  account('a281', '281', { name: 'Amortización acumulada' }),
  account('a622', '622', { allowsCostCentre: true }),
  account('a430', '430', { requiresProperty: true, systemRole: 'owners_receivable' }),
  account('a400', '400', { requiresSupplier: true, systemRole: 'suppliers_payable' }),
  account('a555', '555', { systemRole: 'suspense' }),
  account('a62', '62', { postable: false }),
  account('a629', '629', { archivedAt: '2026-01-01' }),
];

describe('AsientoManualDialogComponent', () => {
  let h: ComponentHarness<AsientoManualDialogComponent>;

  beforeEach(() => {
    h = setupComponent(AsientoManualDialogComponent);
    h.component.estateId = 'e1';
    h.component.accounts = ACCOUNTS;
    h.component.costCentres = [{ id: 'cc1', estateId: 'e1', administratorId: 'a', name: 'Piscina', status: 'Activo' }];
    h.fixture.detectChanges();
  });

  afterEach(() => h.http.verify());

  function fill(lines: { accountId: string; debit?: string; credit?: string; costCentreId?: string }[]) {
    h.component.form = { date: '2026-12-31', concept: 'Amortización del ejercicio', reference: '' };
    h.component.lines = lines.map((l) => ({ debit: '', credit: '', costCentreId: '', concept: '', ...l }));
    h.component.touch();
  }

  it('no ofrece cuentas de documentos (430, 400, 555), agrupadoras ni archivadas', () => {
    expect(h.component.usableAccounts().map((a) => a.code)).toEqual(['281', '622', '681']);
  });

  it('un asiento descuadrado no se envía, y "cuadrar" completa la última línea en el lado que falta', async () => {
    fill([{ accountId: 'a681', debit: '1.200,00' }, { accountId: 'a281', credit: '1000' }]);
    expect(h.component.totals().diff).toBe(200);
    await h.component.save();
    expect(h.component.error()).toContain('no cuadra');

    h.component.balanceLastLine();
    expect(h.component.lines[1]).toEqual(expect.objectContaining({ debit: '', credit: '1200,00' }));
    expect(h.component.totals().diff).toBe(0);
  });

  it('cada línea va solo al debe o solo al haber', async () => {
    fill([{ accountId: 'a681', debit: '10', credit: '10' }, { accountId: 'a281', credit: '0' }]);
    await h.component.save();
    expect(h.component.error()).toContain('Línea 1');
  });

  it('registra el asiento en euros, con el centro de coste solo donde la cuenta lo admite', async () => {
    const saved = vi.fn();
    h.component.saved.subscribe(saved);
    fill([
      { accountId: 'a622', debit: '150,25', costCentreId: 'cc1' },
      { accountId: 'a281', credit: '150,25', costCentreId: 'cc1' },
    ]);
    const done = h.component.save();
    const req = h.http.expectOne(`${API}/estates/e1/journal`);
    expect(req.request.body).toEqual({
      date: '2026-12-31',
      concept: 'Amortización del ejercicio',
      lines: [
        { accountId: 'a622', debit: 150.25, credit: 0, costCentreId: 'cc1' },
        { accountId: 'a281', debit: 0, credit: 150.25 },
      ],
    });
    req.flush({ id: 'j1', fiscalYear: 2026, number: 7, date: '2026-12-31', total: 150.25, lines: [] });
    await settle();
    await done;
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'j1', number: 7 }));
  });

  it('enseña el motivo del backend si rechaza el asiento', async () => {
    fill([{ accountId: 'a681', debit: '10' }, { accountId: 'a281', credit: '10' }]);
    const done = h.component.save();
    h.http.expectOne(`${API}/estates/e1/journal`).flush(
      { message: 'DM010: la fecha es anterior al inicio de la contabilidad.' },
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await done;
    expect(h.component.error()).toContain('anterior al inicio');
  });

  it('una línea más se puede quitar, pero nunca por debajo de dos', () => {
    h.component.addLine();
    expect(h.component.lines).toHaveLength(3);
    h.component.removeLine(2);
    h.component.removeLine(1);
    expect(h.component.lines).toHaveLength(2);
  });
});
