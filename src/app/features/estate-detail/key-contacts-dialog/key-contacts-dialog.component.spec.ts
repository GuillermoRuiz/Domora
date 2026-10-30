import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { KeyContactsDialogComponent } from './key-contacts-dialog.component';

describe('KeyContactsDialogComponent', () => {
  let h: ComponentHarness<KeyContactsDialogComponent>;
  const CANDIDATES = `${API}/estates/e1/office-terms/candidates`;
  const KEY_CONTACTS = `${API}/estates/e1/key-contacts`;
  const switches = () => Array.from(h.el.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  const text = () => h.el.textContent?.replace(/\s+/g, ' ') ?? '';

  async function mount(holders: unknown[] | 'error') {
    h = setupComponent(KeyContactsDialogComponent);
    h.fixture.componentRef.setInput('estateId', 'e1');
    h.fixture.componentRef.setInput('propertyId', 'p1');
    h.fixture.componentRef.setInput('propertyLabel', '1A');
    h.fixture.detectChanges();
    const req = h.http.expectOne(CANDIDATES);
    if (holders === 'error') req.flush({}, { status: 500, statusText: 'Error' });
    else req.flush([{ id: 'p1', ref: '1A', holders }, { id: 'p2', ref: '2B', holders: [{ userId: 'u9', externalOwnerId: null, name: 'Otro', keyContact: true }] }]);
    await settle();
    h.fixture.detectChanges();
  }

  afterEach(() => h.http.verify());

  it('lista los titulares de la propiedad con un interruptor accesible que refleja si son contacto clave', async () => {
    await mount([
      { userId: 'u1', externalOwnerId: null, name: 'Ana Gil', keyContact: true },
      { userId: null, externalOwnerId: 'x1', name: 'Blas Mora', keyContact: false },
    ]);
    expect(text()).toContain('Contactos clave');
    expect(text()).toContain('Propiedad 1A');
    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(text()).not.toContain('Otro');
    const labelled = switches()[0].getAttribute('aria-labelledby')!.split(' ').map((id) => h.el.querySelector(`#${id}`)?.textContent?.trim());
    expect(labelled).toEqual(['Ana Gil', 'Contacto clave']);
  });

  it('marcar a una persona guarda solo esa persona y avisa al padre', async () => {
    await mount([
      { userId: 'u1', externalOwnerId: null, name: 'Ana Gil', keyContact: true },
      { userId: null, externalOwnerId: 'x1', name: 'Blas Mora', keyContact: false },
    ]);
    let changes = 0;
    h.component.changed.subscribe(() => changes++);
    switches()[1].click();
    const req = h.http.expectOne(KEY_CONTACTS);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ propertyId: 'p1', userId: undefined, externalOwnerId: 'x1', keyContact: true });
    req.flush({});
    await settle();
    h.fixture.detectChanges();
    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true']);
    expect(changes).toBe(1);
  });

  it('quitar a una persona envía keyContact: false', async () => {
    await mount([{ userId: 'u1', externalOwnerId: null, name: 'Ana Gil', keyContact: true }]);
    switches()[0].click();
    const req = h.http.expectOne(KEY_CONTACTS);
    expect(req.request.body).toEqual({ propertyId: 'p1', userId: 'u1', externalOwnerId: undefined, keyContact: false });
    req.flush({});
    await settle();
    h.fixture.detectChanges();
    expect(switches()[0].getAttribute('aria-checked')).toBe('false');
  });

  it('si el servidor lo rechaza, el interruptor no cambia y se ve el mensaje', async () => {
    await mount([{ userId: 'u1', externalOwnerId: null, name: 'Ana Gil', keyContact: false }]);
    switches()[0].click();
    h.http.expectOne(KEY_CONTACTS).flush({ message: 'La persona no es titular de esta propiedad.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    h.fixture.detectChanges();
    expect(switches()[0].getAttribute('aria-checked')).toBe('false');
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('La persona no es titular de esta propiedad.');
  });

  it('sin titulares propietarios lo explica', async () => {
    await mount([]);
    expect(text()).toContain('Esta propiedad no tiene titulares propietarios.');
    expect(switches()).toHaveLength(0);
  });

  it('se cierra con «Hecho» y con Escape', async () => {
    await mount([]);
    let closes = 0;
    h.component.closed.subscribe(() => closes++);
    (h.el.querySelector('.modal__footer app-btn button') as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closes).toBe(2);
  });
});
