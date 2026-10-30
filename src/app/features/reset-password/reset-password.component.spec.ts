import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, typeInto, type ComponentHarness } from '../../core/testing/component-harness';
import { ResetPasswordComponent } from './reset-password.component';

function withToken(token: string | null) {
  return {
    provide: ActivatedRoute,
    useValue: { snapshot: { paramMap: convertToParamMap(token ? { token } : {}), queryParamMap: convertToParamMap({}) } },
  };
}

describe('ResetPasswordComponent', () => {
  let h: ComponentHarness<ResetPasswordComponent>;
  let router: Router;

  function setup(token: string | null = 'tok-123') {
    h = setupComponent(ResetPasswordComponent, { realAuth: true, providers: [withToken(token)] });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  }

  afterEach(() => h.http.verify());

  it('sin token en la URL, muestra el error sin llamar a la API', () => {
    setup(null);
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Enlace de recuperación inválido.');
    h.http.expectNone(() => true);
  });

  it('con token, comprueba su validez antes de mostrar el formulario', async () => {
    setup('tok-valido');
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Comprobando el enlace');

    const req = h.http.expectOne(`${API}/auth/forgot-password/tok-valido`);
    req.flush({ valid: true });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelector('#reset-password')).not.toBeNull();
  });

  it('token caducado/inválido: muestra el error del backend en vez del formulario', async () => {
    setup('tok-caducado');
    h.fixture.detectChanges();
    const req = h.http.expectOne(`${API}/auth/forgot-password/tok-caducado`);
    req.flush({ message: 'El enlace de recuperación caducó.' }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('El enlace de recuperación caducó.');
    expect(h.el.querySelector('#reset-password')).toBeNull();
  });

  describe('con el token ya validado', () => {
    async function setupReady(): Promise<void> {
      setup('tok-valido');
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/auth/forgot-password/tok-valido`).flush({ valid: true });
      await settle();
      h.fixture.detectChanges();
    }

    it('contraseña de menos de 8 caracteres: valida en el cliente', async () => {
      await setupReady();
      h.component.password = 'corta';
      h.component.confirmPassword = 'corta';
      await h.component.submit();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('al menos 8 caracteres');
      h.http.expectNone((r) => r.url.includes('/reset-password'));
    });

    it('las contraseñas no coinciden: no llega a llamar a la API', async () => {
      await setupReady();
      h.component.password = 'password123';
      h.component.confirmPassword = 'otra-distinta';
      await h.component.submit();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('no coinciden');
      h.http.expectNone((r) => r.url.includes('/reset-password'));
    });

    it('con todo válido, restablece la contraseña y manda a /login con el aviso — sin iniciar sesión sola', async () => {
      await setupReady();
      typeInto(h.el, '#reset-password', 'password123');
      typeInto(h.el, '#reset-password-confirm', 'password123');
      h.fixture.detectChanges();

      h.el.querySelector('form')!.dispatchEvent(new Event('submit'));
      const req = h.http.expectOne(`${API}/auth/reset-password`);
      expect(req.request.body).toEqual({ token: 'tok-valido', password: 'password123' });
      req.flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(router.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { passwordReset: '1' } });
    });
  });
});
