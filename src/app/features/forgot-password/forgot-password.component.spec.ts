import { API, setupComponent, settle, typeInto, type ComponentHarness } from '../../core/testing/component-harness';
import { ForgotPasswordComponent } from './forgot-password.component';

describe('ForgotPasswordComponent', () => {
  let h: ComponentHarness<ForgotPasswordComponent>;

  beforeEach(() => {
    h = setupComponent(ForgotPasswordComponent, { realAuth: true });
    h.fixture.detectChanges();
  });

  afterEach(() => h.http.verify());

  it('sin email, no llama a la API', async () => {
    await h.component.submit();
    h.http.expectNone(() => true);
  });

  it('muestra el mensaje genérico del backend, exista o no esa cuenta', async () => {
    typeInto(h.el, '#forgot-email', 'quien-sea@demo.app');
    h.fixture.detectChanges();

    h.el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = h.http.expectOne(`${API}/auth/forgot-password`);
    expect(req.request.body).toEqual({ email: 'quien-sea@demo.app' });
    req.flush({ message: 'Si existe una cuenta con ese email, te enviamos un enlace para restablecer la contraseña.' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Si existe una cuenta con ese email');
    expect(h.component.submitted()).toBe(true);
  });

  it('ante un fallo real de red/servidor, muestra un aviso distinto pero igual marca submitted (no atasca al usuario)', async () => {
    h.component.email = 'quien-sea@demo.app';
    const submitPromise = h.component.submit();
    const req = h.http.expectOne(`${API}/auth/forgot-password`);
    req.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await submitPromise;
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('No se pudo procesar la solicitud');
    expect(h.component.submitted()).toBe(true);
  });
});
