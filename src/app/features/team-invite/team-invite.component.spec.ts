import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, typeInto, type ComponentHarness } from '../../core/testing/component-harness';
import { TeamInviteComponent } from './team-invite.component';

/**
 * Estructuralmente calcado de admin-invite.component.spec.ts — mismo flujo,
 * pero contra /auth/team-invites en vez de /auth/admin-invites (invitación
 * de un colega a una gestora YA existente, no de alta de gestora nueva).
 */
function withToken(token: string | null) {
  return {
    provide: ActivatedRoute,
    useValue: { snapshot: { paramMap: convertToParamMap(token ? { token } : {}), queryParamMap: convertToParamMap({}) } },
  };
}

describe('TeamInviteComponent', () => {
  let h: ComponentHarness<TeamInviteComponent>;
  let router: Router;

  function setup(token: string | null = 'tok-123') {
    h = setupComponent(TeamInviteComponent, { realAuth: true, providers: [withToken(token)] });
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

  it('con token, muestra el nombre de la gestora a la que se une', async () => {
    setup('tok-valido');
    h.fixture.detectChanges();

    const req = h.http.expectOne(`${API}/auth/team-invites/tok-valido`);
    req.flush({ administratorName: 'Fincas García S.L.' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Fincas García S.L.');
  });

  it('invitación ya canjeada: muestra el mensaje real del backend en vez del formulario', async () => {
    setup('tok-usado');
    h.fixture.detectChanges();
    const req = h.http.expectOne(`${API}/auth/team-invites/tok-usado`);
    req.flush({ message: 'Este enlace de invitación ya fue utilizado.' }, { status: 409, statusText: 'Conflict' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Este enlace de invitación ya fue utilizado.');
    expect(h.el.querySelector('#team-invite-password')).toBeNull();
  });

  describe('con la invitación ya validada', () => {
    async function setupReady(): Promise<void> {
      setup('tok-valido');
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/auth/team-invites/tok-valido`).flush({ administratorName: 'Fincas García S.L.' });
      await settle();
      h.fixture.detectChanges();
    }

    it('contraseña de menos de 8 caracteres, valida en el cliente', async () => {
      await setupReady();
      h.component.fullName = 'Juan';
      h.component.email = 'juan@demo.app';
      h.component.password = 'corta';
      await h.component.submit();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('al menos 8 caracteres');
      h.http.expectNone((r) => r.url.includes('/redeem'));
    });

    it('sin aceptar los términos, no llama a la API', async () => {
      await setupReady();
      h.component.fullName = 'Juan';
      h.component.email = 'juan@demo.app';
      h.component.password = 'password123';
      await h.component.submit();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Tienes que aceptar los Términos y la Política de Privacidad.');
      h.http.expectNone((r) => r.url.includes('/redeem'));
    });

    it('completa el alta y navega al panel de la gestora — se une al MISMO equipo, sin volver a pedir el CIF', async () => {
      await setupReady();
      typeInto(h.el, '#team-invite-name', 'Juan Colega');
      typeInto(h.el, '#team-invite-email', 'juan@demo.app');
      typeInto(h.el, '#team-invite-password', 'password123');
      h.component.termsAccepted = true;
      h.fixture.detectChanges();

      h.el.querySelector('form')!.dispatchEvent(new Event('submit'));
      const req = h.http.expectOne(`${API}/auth/team-invites/tok-valido/redeem`);
      expect(req.request.body).toEqual({
        email: 'juan@demo.app', password: 'password123', fullName: 'Juan Colega', termsAccepted: true,
      });
      req.flush({
        accessToken: 'tok', refreshToken: 'ref',
        user: { id: 'u2', fullName: 'Juan Colega', role: 'B', estateIds: [], administratorId: 'a1' },
      });
      await settle();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/b/estates');
    });
  });
});
