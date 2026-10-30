import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, typeInto, type ComponentHarness } from '../../core/testing/component-harness';
import { AdminInviteComponent } from './admin-invite.component';

function withToken(token: string | null) {
  return {
    provide: ActivatedRoute,
    useValue: { snapshot: { paramMap: convertToParamMap(token ? { token } : {}), queryParamMap: convertToParamMap({}) } },
  };
}

describe('AdminInviteComponent', () => {
  let h: ComponentHarness<AdminInviteComponent>;
  let router: Router;

  function setup(token: string | null = 'tok-123') {
    h = setupComponent(AdminInviteComponent, { realAuth: true, providers: [withToken(token)] });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  }

  afterEach(() => h.http.verify());

  it('sin token en la URL, muestra el error sin llamar a la API', () => {
    setup(null);
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Enlace de invitación inválido.');
    h.http.expectNone(() => true);
  });

  it('con token, muestra el nombre de la gestora antes de pedir contraseña', async () => {
    setup('tok-valido');
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Comprobando el enlace');

    const req = h.http.expectOne(`${API}/auth/admin-invites/tok-valido`);
    req.flush({ administratorName: 'Fincas García S.L.' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Fincas García S.L.');
  });

  it('invitación ya canjeada: muestra el mensaje real del backend en vez del formulario', async () => {
    setup('tok-usado');
    h.fixture.detectChanges();
    const req = h.http.expectOne(`${API}/auth/admin-invites/tok-usado`);
    req.flush({ message: 'Este enlace de invitación ya fue utilizado.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Este enlace de invitación ya fue utilizado.');
    expect(h.el.querySelector('#invite-password')).toBeNull();
  });

  describe('con la invitación ya validada', () => {
    async function setupReady(): Promise<void> {
      setup('tok-valido');
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/auth/admin-invites/tok-valido`).flush({ administratorName: 'Fincas García S.L.' });
      await settle();
      h.fixture.detectChanges();
    }

    it('contraseña de menos de 8 caracteres, valida en el cliente', async () => {
      await setupReady();
      h.component.fullName = 'Ana';
      h.component.email = 'ana@demo.app';
      h.component.password = 'corta';
      await h.component.submit();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('al menos 8 caracteres');
      h.http.expectNone((r) => r.url.includes('/redeem'));
    });

    it('sin aceptar los términos, no llama a la API', async () => {
      await setupReady();
      h.component.fullName = 'Ana';
      h.component.email = 'ana@demo.app';
      h.component.password = 'password123';
      await h.component.submit();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Tienes que aceptar los Términos y la Política de Privacidad.');
      h.http.expectNone((r) => r.url.includes('/redeem'));
    });

    it('completa el alta y navega al panel de la gestora', async () => {
      await setupReady();
      typeInto(h.el, '#invite-name', 'Ana Gestora');
      typeInto(h.el, '#invite-email', 'ana@demo.app');
      typeInto(h.el, '#invite-password', 'password123');
      h.component.termsAccepted = true;
      h.fixture.detectChanges();

      h.el.querySelector('form')!.dispatchEvent(new Event('submit'));
      const req = h.http.expectOne(`${API}/auth/admin-invites/tok-valido/redeem`);
      expect(req.request.body).toEqual({
        email: 'ana@demo.app', password: 'password123', fullName: 'Ana Gestora', termsAccepted: true,
      });
      req.flush({
        accessToken: 'tok', refreshToken: 'ref',
        user: { id: 'u1', fullName: 'Ana Gestora', role: 'B', estateIds: [], administratorId: 'a1' },
      });
      await settle();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/b/overview');
    });
  });
});
