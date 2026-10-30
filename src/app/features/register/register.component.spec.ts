import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, typeInto, type ComponentHarness } from '../../core/testing/component-harness';
import { RegisterComponent } from './register.component';
import { StateService } from '../../core/state.service';

describe('RegisterComponent', () => {
  let h: ComponentHarness<RegisterComponent>;
  let router: Router;
  let state: StateService;

  beforeEach(() => {
    h = setupComponent(RegisterComponent, { realAuth: true });
    router = TestBed.inject(Router);
    state = TestBed.inject(StateService);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    h.fixture.detectChanges();
  });

  afterEach(() => h.http.verify());

  it('con campos vacíos, no llama a la API', async () => {
    await h.component.submit();
    h.http.expectNone(() => true);
  });

  it('con contraseña de menos de 8 caracteres, valida en el cliente sin llegar al backend', async () => {
    h.component.fullName = 'Pepe Propietario';
    h.component.email = 'pepe@demo.app';
    h.component.password = 'corta';
    await h.component.submit();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('al menos 8 caracteres');
    h.http.expectNone(() => true);
  });

  it('registro correcto: crea la cuenta, abre el wizard de alta de propiedad y navega', async () => {
    typeInto(h.el, '#register-name', 'Pepe Propietario');
    typeInto(h.el, '#register-email', 'pepe@demo.app');
    typeInto(h.el, '#register-password', 'password123');
    h.component.termsAccepted = true;
    h.fixture.detectChanges();

    h.el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = h.http.expectOne(`${API}/auth/register`);
    expect(req.request.body).toEqual({
      email: 'pepe@demo.app', password: 'password123', fullName: 'Pepe Propietario', termsAccepted: true,
    });
    req.flush({
      accessToken: 'tok', refreshToken: 'ref',
      user: { id: 'u1', fullName: 'Pepe Propietario', role: 'C', estateIds: [], administratorId: null },
    });
    await settle();

    expect(state.showAddPropertyModal()).toBe(true);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/c/community');
  });

  it('sin aceptar los términos, no llama a la API', async () => {
    h.component.fullName = 'Pepe Propietario';
    h.component.email = 'pepe@demo.app';
    h.component.password = 'password123';
    await h.component.submit();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Tienes que aceptar los Términos y la Política de Privacidad.');
    h.http.expectNone(() => true);
  });

  it('email ya existente: muestra el mensaje real del backend, no uno genérico', async () => {
    h.component.fullName = 'Pepe Propietario';
    h.component.email = 'ya-existe@demo.app';
    h.component.password = 'password123';
    h.component.termsAccepted = true;

    const submitPromise = h.component.submit();
    const req = h.http.expectOne(`${API}/auth/register`);
    req.flush({ message: 'Ya existe una cuenta con ese email.' }, { status: 409, statusText: 'Conflict' });
    await submitPromise;
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Ya existe una cuenta con ese email.');
  });
});
