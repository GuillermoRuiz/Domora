import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { OfficeTermDialogComponent, type OfficeTermDialogMode } from './office-term-dialog.component';
import { currentOffices, type EstateOfficeTerm, type OfficeHolder } from '../../../core/estate-governance.service';

const term = (over: Partial<EstateOfficeTerm>): EstateOfficeTerm => ({
  id: 't', estateId: 'e1', role: 'PRESIDENT', propertyId: 'p9', userId: null, externalOwnerId: null,
  holderNameSnapshot: 'Titular', startsAt: '2025-01-01', endsAt: null, propertyReference: null, ...over,
});
const PRESIDENT = term({ id: 'pres', holderNameSnapshot: 'Pilar Ruiz', externalOwnerId: 'x-pilar', propertyReference: '3ºB', startsAt: '2025-03-10' });
const VICE_1 = term({ id: 'v1', role: 'VICE_PRESIDENT', holderNameSnapshot: 'Ana Gil', externalOwnerId: 'x-ana', startsAt: '2025-04-01' });
const VICE_2 = term({ id: 'v2', role: 'VICE_PRESIDENT', holderNameSnapshot: 'Luis Mora', userId: 'u-luis', startsAt: '2025-05-01' });
const CANDIDATES_URL = `${API}/estates/e1/office-terms/candidates`;
const TERMS_URL = `${API}/estates/e1/office-terms`;

describe('OfficeTermDialogComponent', () => {
  let h: ComponentHarness<OfficeTermDialogComponent>;
  const text = () => h.el.textContent?.replace(/\s+/g, ' ') ?? '';
  const submitBtn = () => Array.from(h.el.querySelectorAll<HTMLButtonElement>('.modal__footer button')).at(-1)!;

  async function mount(mode: OfficeTermDialogMode, terms: EstateOfficeTerm[], holders: OfficeHolder[] | null) {
    h = setupComponent(OfficeTermDialogComponent);
    const ref = h.fixture.componentRef;
    ref.setInput('estateId', 'e1');
    ref.setInput('propertyId', 'p1');
    ref.setInput('propertyLabel', '1ºA');
    ref.setInput('mode', mode);
    ref.setInput('terms', terms);
    h.component.day.set('2026-06-01');
    h.fixture.detectChanges();
    if (holders) h.http.expectOne(CANDIDATES_URL).flush([{ id: 'p1', ref: '1ºA', holders }, { id: 'p9', ref: '3ºB', holders: [] }]);
    await settle();
    h.fixture.detectChanges();
  }

  afterEach(() => h.http.verify());

  it('nombrar presidente cuando ya hay uno: avisa de que su mandato termina en la fecha elegida', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [PRESIDENT], [{ userId: null, externalOwnerId: 'x-eva', name: 'Eva Sanz' }]);
    expect(text()).toContain('Nombrar presidente');
    expect(text()).toContain('Pilar Ruiz (3ºB) es presidente desde el 10/03/2025. Al nombrar a Eva Sanz, su mandato terminará el 01/06/2026.');

    submitBtn().click();
    const req = h.http.expectOne(TERMS_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ role: 'PRESIDENT', startsAt: '2026-06-01', propertyId: 'p1', userId: undefined, externalOwnerId: 'x-eva' });
    let saved = false;
    h.component.saved.subscribe(() => (saved = true));
    req.flush(term({}));
    await settle();
    expect(saved).toBe(true);
  });

  it('nombrar presidente sin presidente previo: no muestra avisos', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [], [{ userId: 'u1', externalOwnerId: null, name: 'Eva Sanz' }]);
    expect(h.el.querySelector('.notice--warning')).toBeNull();
    expect(submitBtn().disabled).toBe(false);
  });

  it('ascender al vicepresidente 1º: avisa del cese del presidente, de su vicepresidencia y de que los demás suben', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [PRESIDENT, VICE_1, VICE_2], [{ userId: null, externalOwnerId: 'x-ana', name: 'Ana Gil' }]);
    expect(text()).toContain('su mandato terminará el 01/06/2026');
    expect(text()).toContain('Ana Gil dejará de ser vicepresidente 1º el 01/06/2026.');
    expect(text()).toContain('Los vicepresidentes que van detrás suben un puesto.');
  });

  it('nombrar vicepresidente lo añade al final sin cesar a los demás', async () => {
    await mount({ kind: 'appoint', role: 'VICE_PRESIDENT' }, [PRESIDENT, VICE_1], [{ userId: null, externalOwnerId: 'x-eva', name: 'Eva Sanz' }]);
    expect(text()).toContain('Eva Sanz será vicepresidente 2º. Los demás vicepresidentes siguen en el cargo.');
  });

  it('bloquea un segundo cargo de la misma persona (el presidente no puede ser vicepresidente)', async () => {
    await mount({ kind: 'appoint', role: 'VICE_PRESIDENT' }, [PRESIDENT], [{ userId: null, externalOwnerId: 'x-pilar', name: 'Pilar Ruiz' }]);
    expect(text()).toContain('Pilar Ruiz ya es presidente de la comunidad.');
    expect(submitBtn().disabled).toBe(true);
  });

  it('no deja nombrar presidente el mismo día en que empezó el mandato del actual (el servidor lo rechazaría)', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [term({ ...PRESIDENT, startsAt: '2026-06-01' })], [{ userId: null, externalOwnerId: 'x-eva', name: 'Eva Sanz' }]);
    expect(text()).toContain('El mandato de Pilar Ruiz empieza el 01/06/2026. Elige una fecha posterior.');
    expect(submitBtn().disabled).toBe(true);
    h.component.day.set('2026-06-02');
    h.fixture.detectChanges();
    expect(text()).not.toContain('Elige una fecha posterior');
    expect(submitBtn().disabled).toBe(false);
  });

  it('no deja ascender a un vicepresidente el mismo día en que empezó su vicepresidencia', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [term({ ...VICE_1, startsAt: '2026-06-01' })], [{ userId: null, externalOwnerId: 'x-ana', name: 'Ana Gil' }]);
    expect(text()).toContain('La vicepresidencia de Ana Gil empieza el 01/06/2026. Elige una fecha posterior.');
    expect(submitBtn().disabled).toBe(true);
  });

  it('copropiedad: pide elegir a la persona y los avisos siguen a la elegida', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [PRESIDENT, VICE_1], [
      { userId: null, externalOwnerId: 'x-eva', name: 'Eva Sanz' },
      { userId: null, externalOwnerId: 'x-ana', name: 'Ana Gil' },
    ]);
    expect(text()).toContain('¿Quién ocupa el cargo?');
    expect(h.el.querySelectorAll('input[type="radio"]').length).toBe(2);
    expect(text()).not.toContain('dejará de ser vicepresidente');
    h.component.holderIndex.set(1);
    h.fixture.detectChanges();
    expect(text()).toContain('Ana Gil dejará de ser vicepresidente 1º');
  });

  it('propiedad sin titulares propietarios: lo explica y no deja guardar', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [], []);
    expect(text()).toContain('Esta propiedad no tiene titulares propietarios.');
    expect(submitBtn().disabled).toBe(true);
  });

  it('cesar al presidente: avisa de que la comunidad queda sin presidente y envía la fecha de cese', async () => {
    const office = currentOffices([PRESIDENT], '2026-06-01').president!;
    await mount({ kind: 'end', office }, [PRESIDENT], null);
    expect(text()).toContain('Cesar como presidente');
    expect(text()).toContain('Pilar Ruiz dejará de ser presidente el 01/06/2026. La comunidad quedará sin presidente hasta que nombres a otro.');
    submitBtn().click();
    const req = h.http.expectOne(`${TERMS_URL}/pres/end`);
    expect(req.request.body).toEqual({ endsAt: '2026-06-01' });
    req.flush(term({}));
    await settle();
  });

  it('cesar al vicepresidente 1º avisa de que los siguientes suben; el último no', async () => {
    const [first, second] = currentOffices([VICE_1, VICE_2], '2026-06-01').vicePresidents;
    await mount({ kind: 'end', office: first }, [VICE_1, VICE_2], null);
    expect(text()).toContain('Cesar como vicepresidente 1º');
    expect(text()).toContain('Los vicepresidentes que van detrás suben un puesto.');
    h.fixture.componentRef.setInput('mode', { kind: 'end', office: second });
    h.fixture.detectChanges();
    expect(text()).not.toContain('suben un puesto');
  });

  it('muestra el mensaje del servidor si el guardado falla', async () => {
    await mount({ kind: 'appoint', role: 'PRESIDENT' }, [], [{ userId: 'u1', externalOwnerId: null, name: 'Eva Sanz' }]);
    submitBtn().click();
    h.http.expectOne(TERMS_URL).flush({ message: 'Eva Sanz ya es vicepresidente de la comunidad.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('Eva Sanz ya es vicepresidente de la comunidad.');
  });
});
