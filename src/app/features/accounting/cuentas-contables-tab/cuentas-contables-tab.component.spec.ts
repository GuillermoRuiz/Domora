import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { CuentasContablesTabComponent } from './cuentas-contables-tab.component';
import type { AccountingEstate, ChartAccount } from '../../../core/models';

function makeEstate(overrides: Partial<AccountingEstate> = {}): AccountingEstate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, delinquency: 0, units: 10,
    ...overrides,
  };
}

function makeAccount(overrides: Partial<ChartAccount> = {}): ChartAccount {
  return {
    id: 'ca1', estateId: 'e1', code: '628', name: 'Suministros', shortName: null,
    nature: 'expense', level: 1, postable: true, system: true, systemRole: null, archivedAt: null,
    ...overrides,
  };
}

const PLAN: ChartAccount[] = [
  makeAccount({ id: 'a430', code: '430', name: 'Propietarios', nature: 'asset', systemRole: 'owners_receivable' }),
  makeAccount({ id: 'a572', code: '572', name: 'Bancos', nature: 'asset', postable: false }),
  makeAccount({ id: 'a5720001', code: '5720001', name: 'Banco — Principal', nature: 'asset', level: 2, system: false, systemRole: 'bank' }),
  makeAccount({ id: 'a628', code: '628', name: 'Suministros' }),
  makeAccount({ id: 'a6280001', code: '6280001', name: 'Luz', level: 2, system: false }),
  makeAccount({ id: 'a700', code: '700', name: 'Cuotas ordinarias', nature: 'income', systemRole: 'income_ordinary' }),
  makeAccount({ id: 'a629', code: '629', name: 'Otros servicios', archivedAt: '2026-05-01T00:00:00Z', system: false }),
];

function buttonIn(row: Element, text: string): HTMLButtonElement | undefined {
  return Array.from(row.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

function rowFor(el: HTMLElement, code: string): Element {
  return Array.from(el.querySelectorAll('tbody tr')).find((r) => r.querySelector('.td-code')?.textContent?.trim() === code)!;
}

describe('CuentasContablesTabComponent', () => {
  let h: ComponentHarness<CuentasContablesTabComponent>;

  beforeEach(() => {
    h = setupComponent(CuentasContablesTabComponent);
    h.component.estate = makeEstate();
  });

  afterEach(() => h.http.verify());

  async function mount(accounts: ChartAccount[] = PLAN): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne((r) => r.url === `${API}/estates/e1/chart-accounts`).flush(accounts);
    await settle();
    h.fixture.detectChanges();
  }

  it('agrupa por grupo del plan, en orden de código, y esconde las archivadas', async () => {
    await mount();
    const groups = Array.from(h.el.querySelectorAll('.group__row')).map((r) => r.textContent?.trim());
    expect(groups).toEqual([
      'Grupo 4 · Propietarios, proveedores y administraciones',
      'Grupo 5 · Tesorería',
      'Grupo 6 · Gastos',
      'Grupo 7 · Ingresos',
    ]);
    const codes = Array.from(h.el.querySelectorAll('.td-code')).map((n) => n.textContent?.trim());
    expect(codes).toEqual(['430', '572', '5720001', '628', '6280001', '700']);
    expect(h.el.textContent).toContain('Ver archivadas (1)');
  });

  it('"Ver archivadas" muestra también las cuentas archivadas', async () => {
    await mount();
    h.component.showArchived.set(true);
    h.fixture.detectChanges();
    expect(rowFor(h.el, '629').classList).toContain('tr--archived');
  });

  it('las subcuentas se sangran según su nivel', async () => {
    await mount();
    const sub = rowFor(h.el, '6280001').querySelector('.td-code') as HTMLElement;
    const top = rowFor(h.el, '628').querySelector('.td-code') as HTMLElement;
    expect(sub.style.paddingLeft).toBe('40px');
    expect(top.style.paddingLeft).toBe('20px');
  });

  it('acciones según el tipo de cuenta', async () => {
    await mount();
    // Cuenta con papel en la contabilidad automática: ni archivar ni borrar.
    expect(buttonIn(rowFor(h.el, '430'), 'Archivar')).toBeUndefined();
    expect(buttonIn(rowFor(h.el, '430'), 'Borrar')).toBeUndefined();
    expect(buttonIn(rowFor(h.el, '430'), 'Subcuenta')).toBeDefined();
    // Los bancos se dan de alta en Configuración, no aquí.
    expect(buttonIn(rowFor(h.el, '572'), 'Subcuenta')).toBeUndefined();
    expect(buttonIn(rowFor(h.el, '5720001'), 'Borrar')).toBeUndefined();
    // Cuenta propia: se puede archivar y borrar.
    expect(buttonIn(rowFor(h.el, '6280001'), 'Archivar')).toBeDefined();
    expect(buttonIn(rowFor(h.el, '6280001'), 'Borrar')).toBeDefined();
  });

  it('sin cuentas, muestra el estado vacío', async () => {
    await mount([]);
    expect(h.el.textContent).toContain('Todavía no hay cuentas contables en esta finca');
  });

  describe('nueva cuenta y subcuenta', () => {
    it('sin código válido ni nombre no envía nada', async () => {
      await mount();
      h.component.openNuevaCuenta();
      h.component.ncCode.set('62a');
      await h.component.submitNuevaCuenta();
      expect(h.component.ncErrors()).toEqual({ code: true, name: true });
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('una subcuenta prerrellena el código del padre y exige que empiece por él', async () => {
      await mount();
      buttonIn(rowFor(h.el, '628'), 'Subcuenta')!.click();
      h.fixture.detectChanges();
      expect(h.component.ncCode()).toBe('628');
      expect(h.el.textContent).toContain('Nueva subcuenta de 628');

      h.component.ncCode.set('6290001');
      h.component.ncName.set('Agua');
      await h.component.submitNuevaCuenta();
      expect(h.component.ncErrors().prefix).toBe(true);
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('crea la subcuenta con el padre y sin tipo, y la coloca bajo su padre', async () => {
      await mount();
      h.component.openNuevaCuenta(PLAN.find((a) => a.code === '628')!);
      h.component.ncCode.set('6280002');
      h.component.ncName.set('Agua');

      const submit = h.component.submitNuevaCuenta();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/chart-accounts` && r.method === 'POST');
      expect(req.request.body).toEqual({ code: '6280002', name: 'Agua', parentId: 'a628' });
      req.flush(makeAccount({ id: 'nueva', code: '6280002', name: 'Agua', level: 2, system: false, parentId: 'a628' }));
      await submit;
      h.fixture.detectChanges();

      const codes = Array.from(h.el.querySelectorAll('.td-code')).map((n) => n.textContent?.trim());
      expect(codes.indexOf('6280002')).toBe(codes.indexOf('6280001') + 1);
      expect(h.el.querySelector('.toast')?.textContent).toContain('creada correctamente');
    });

    it('muestra el error del backend (código repetido)', async () => {
      await mount();
      h.component.openNuevaCuenta();
      h.component.ncCode.set('628');
      h.component.ncName.set('Repetida');
      const submit = h.component.submitNuevaCuenta();
      h.http
        .expectOne((r) => r.method === 'POST')
        .flush({ message: 'Ya existe una cuenta 628 en esta finca.' }, { status: 409, statusText: 'Conflict' });
      await submit;
      expect(h.component.ncError()).toBe('Ya existe una cuenta 628 en esta finca.');
    });
  });

  it('archivar manda PATCH { archived: true } y marca la fila', async () => {
    await mount();
    h.component.showArchived.set(true);
    const toggle = h.component.toggleArchived(PLAN.find((a) => a.code === '6280001')!);
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/chart-accounts/a6280001` && r.method === 'PATCH');
    expect(req.request.body).toEqual({ archived: true });
    req.flush(makeAccount({ id: 'a6280001', code: '6280001', name: 'Luz', level: 2, system: false, archivedAt: '2026-09-25T00:00:00Z' }));
    await toggle;
    h.fixture.detectChanges();
    expect(rowFor(h.el, '6280001').classList).toContain('tr--archived');
  });

  it('borrar pide confirmación y, si la cuenta tiene apuntes, muestra el motivo', async () => {
    await mount();
    buttonIn(rowFor(h.el, '6280001'), 'Borrar')!.click();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Se borrará');
    h.http.expectNone((r) => r.method === 'DELETE');

    const confirm = h.component.confirmDelete();
    h.http
      .expectOne((r) => r.method === 'DELETE' && r.url === `${API}/estates/e1/chart-accounts/a6280001`)
      .flush({ message: 'La cuenta 6280001 tiene apuntes y no se puede borrar: archívala.' }, { status: 409, statusText: 'Conflict' });
    await confirm;
    h.fixture.detectChanges();

    expect(h.el.querySelector('.action-error')?.textContent).toContain('tiene apuntes');
    expect(rowFor(h.el, '6280001')).toBeDefined();
  });
});
