import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { SepaTabComponent } from './sepa-tab.component';
import type { EstateSepaBilling } from '../../../core/models';

function makeSepaBilling(overrides: Partial<EstateSepaBilling> = {}): EstateSepaBilling {
  return {
    creditorId: 'ES23000B00000000', creditorIbanMasked: 'ES12 **** **** **** 1234', creditorBic: 'CAIXESBBXXX',
    creditorPostalAddress: 'Calle Mayor 10',
    ...overrides,
  };
}

const URL = `${API}/estates/e1/sepa-billing`;

describe('SepaTabComponent', () => {
  let h: ComponentHarness<SepaTabComponent>;

  beforeEach(() => {
    h = setupComponent(SepaTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  async function load(billing: EstateSepaBilling = makeSepaBilling()): Promise<void> {
    h.fixture.detectChanges(); // dispara ngOnInit
    h.http.expectOne((r) => r.url === URL).flush(billing);
    await settle();
    h.fixture.detectChanges();
  }

  it('al montarse carga la facturación SEPA y pinta los datos del acreedor', async () => {
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando');
    h.http.expectOne((r) => r.url === URL).flush(makeSepaBilling());
    await settle();
    h.fixture.detectChanges();

    expect(h.component.loaded()).toBe(true);
    expect(h.el.querySelector('.billing-grid')).not.toBeNull();
  });

  it('editar NUNCA precarga el IBAN — "editar = reemplazar"', async () => {
    await load(makeSepaBilling({ creditorIbanMasked: 'ES12 **** 1234' }));

    h.component.openEdit();
    h.fixture.detectChanges();

    expect(h.component.creditorIban()).toBe('');
    expect(h.component.creditorId()).toBe('ES23000B00000000'); // el resto de campos SÍ se precarga
  });

  it('guardar sin tocar el IBAN no manda creditorIban en el PATCH (conserva el guardado)', async () => {
    await load();
    const saved = vi.fn();
    h.component.saved.subscribe(saved);
    h.component.openEdit();
    h.component.creditorBic.set('BBVAESMMXXX');

    const savePromise = h.component.save();
    const req = h.http.expectOne((r) => r.url === URL && r.method === 'PATCH');
    expect(req.request.body).not.toHaveProperty('creditorIban');
    expect(req.request.body).toMatchObject({ creditorBic: 'BBVAESMMXXX' });
    req.flush(makeSepaBilling({ creditorBic: 'BBVAESMMXXX' }));
    await savePromise;
    h.fixture.detectChanges();

    expect(h.component.editing()).toBe(false);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(h.el.querySelector('.toast')?.textContent).toContain('actualizada correctamente');
  });

  it('guardar con un IBAN nuevo lo incluye en el PATCH', async () => {
    await load();
    h.component.openEdit();
    h.component.creditorIban.set('ES9820385778983000760236');

    const savePromise = h.component.save();
    const req = h.http.expectOne((r) => r.url === URL && r.method === 'PATCH');
    expect(req.request.body).toMatchObject({ creditorIban: 'ES9820385778983000760236' });
    req.flush(makeSepaBilling());
    await savePromise;
  });

  it('si falla el guardado, muestra un toast de error específico y no avisa al padre', async () => {
    await load();
    const saved = vi.fn();
    h.component.saved.subscribe(saved);
    h.component.openEdit();

    const savePromise = h.component.save();
    h.http.expectOne((r) => r.url === URL && r.method === 'PATCH')
      .flush({ message: 'CID inválido' }, { status: 400, statusText: 'Bad Request' });
    await savePromise;
    h.fixture.detectChanges();

    expect(h.component.saving()).toBe(false);
    expect(saved).not.toHaveBeenCalled();
    expect(h.el.querySelector('.toast')?.textContent).toContain('No se pudo actualizar la facturación SEPA');
  });
});
