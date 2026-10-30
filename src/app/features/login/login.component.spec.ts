import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, submitForm, typeInto, type ComponentHarness } from '../../core/testing/component-harness';
import { LoginComponent } from './login.component';

function withQueryParams(params: Record<string, string>) {
  return {
    provide: ActivatedRoute,
    useValue: { snapshot: { queryParamMap: convertToParamMap(params), paramMap: convertToParamMap({}) } },
  };
}

const rawUser = { id: 'u1', fullName: 'Ana Gestora', role: 'B', estateIds: ['e1'], administratorId: 'a1' };

describe('LoginComponent', () => {
  let h: ComponentHarness<LoginComponent>;
  let router: Router;

  // El `await settle()` tras el primer detectChanges() es necesario: sin él,
  // el registro de NgModel/FormsModule queda a medio asentar en este runner
  // (zoneless + Vitest + jsdom) y los `typeInto(...)` posteriores no llegan
  // a actualizar el modelo — confirmado con un repro mínimo ajeno a este
  // componente. Con `beforeEach()` no hace falta (el propio ciclo de hooks
  // ya da ese respiro), pero acá se arma la fixture a mano por test porque
  // cada uno necesita query params distintos.
  async function setup(queryParams: Record<string, string> = {}) {
    h = setupComponent(LoginComponent, { realAuth: true, providers: [withQueryParams(queryParams)] });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    h.fixture.detectChanges();
    await settle();
  }

  afterEach(() => h.http.verify());

  it('sin email ni contraseña, no llama a la API', async () => {
    await setup();
    await h.component.submit();
    h.http.expectNone(() => true);
  });

  it('con credenciales correctas, hace login y navega a la pantalla del rol', async () => {
    await setup();
    typeInto(h.el, '#login-email', 'ana@demo.app');
    typeInto(h.el, '#login-password', 'secret123');
    h.fixture.detectChanges();

    submitForm(h.el);
    const req = h.http.expectOne(`${API}/auth/login`);
    expect(req.request.body).toEqual({ email: 'ana@demo.app', password: 'secret123' });
    req.flush({ accessToken: 'tok', refreshToken: 'ref', user: rawUser });
    await settle();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/b/overview');
  });

  it('credenciales inválidas: siempre el mismo mensaje genérico, sin filtrar el motivo real del backend', async () => {
    await setup();
    typeInto(h.el, '#login-email', 'ana@demo.app');
    typeInto(h.el, '#login-password', 'mal');
    h.fixture.detectChanges();

    const submitPromise = h.component.submit();
    const req = h.http.expectOne(`${API}/auth/login`);
    req.flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    await submitPromise;
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Email o contraseña incorrectos.');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  describe('passwordResetSuccess', () => {
    it('con ?passwordReset=1, muestra el aviso de contraseña actualizada', async () => {
      await setup({ passwordReset: '1' });
      expect(h.el.textContent).toContain('Contraseña actualizada');
    });

    it('sin el query param, no lo muestra', async () => {
      await setup();
      expect(h.el.textContent).not.toContain('Contraseña actualizada');
    });
  });

  // En los tests `demo/demo-ui` es la versión de PRODUCCIÓN (sin fileReplacements):
  // el login no debe tener rastro del modo demo. La versión demo se prueba en
  // login.component.demo.spec.ts.
  describe('sin modo demo (build de producción)', () => {
    it('no renderiza el botón "Modo demo", el modal ni sus cuentas', async () => {
      await setup();

      expect(h.component.demoPanel).toBeNull();
      expect(h.el.querySelector('app-demo-login-panel')).toBeNull();
      expect(h.el.textContent).not.toContain('Modo demo');
      expect(h.el.textContent).not.toContain('Elige un rol de prueba');
    });
  });
});
