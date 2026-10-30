import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { MembershipInviteComponent } from './membership-invite.component';

/** Mismo molde que team-invite.component.spec.ts, pero el canje requiere sesión iniciada en vez de crear una cuenta. */
function withToken(token: string | null) {
  return {
    provide: ActivatedRoute,
    useValue: { snapshot: { paramMap: convertToParamMap(token ? { token } : {}), queryParamMap: convertToParamMap({}) } },
  };
}

describe('MembershipInviteComponent', () => {
  let h: ComponentHarness<MembershipInviteComponent>;
  let router: Router;

  function setup(token: string | null = 'tok-123') {
    h = setupComponent(MembershipInviteComponent, { providers: [withToken(token)] });
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

  it('token inválido: muestra el mensaje real del backend', async () => {
    setup('tok-invalido');
    h.fixture.detectChanges();
    const req = h.http.expectOne(`${API}/membership-invites/tok-invalido`);
    req.flush({ message: 'El enlace de invitación no es válido.' }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('El enlace de invitación no es válido.');
  });

  describe('con la invitación ya validada', () => {
    async function setupReady(user: ReturnType<typeof makeUser> | null = null): Promise<void> {
      setup('tok-valido');
      h.setCurrentUser(user);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/membership-invites/tok-valido`).flush({
        roleType: 'Inquilino', propertyAddress: 'Calle Mayor 3 2ºA', estateName: 'Residencial Sol',
      });
      await settle();
      h.fixture.detectChanges();
    }

    it('muestra el rol, la dirección y la finca de la invitación', async () => {
      await setupReady();
      expect(h.el.textContent).toContain('Inquilino');
      expect(h.el.textContent).toContain('Calle Mayor 3 2ºA');
      expect(h.el.textContent).toContain('Residencial Sol');
    });

    it('sin sesión iniciada, invita a iniciar sesión o registrarse — no muestra "Aceptar invitación"', async () => {
      await setupReady(null);

      expect(Array.from(h.el.querySelectorAll('button')).some((b) => b.textContent?.includes('Aceptar invitación'))).toBe(false);
      expect(h.el.querySelector('a[href="/login"]')).not.toBeNull();
      expect(h.el.querySelector('a[href="/register"]')).not.toBeNull();
    });

    it('con sesión iniciada, acepta la invitación y navega a la propiedad', async () => {
      await setupReady(makeUser({ id: 'u2', role: 'C' }));
      const reloadSpy = vi.spyOn(h.auth, 'reloadSession');

      const acceptBtn = Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Aceptar invitación'))!;
      acceptBtn.click();

      const req = h.http.expectOne(`${API}/membership-invites/tok-valido/redeem`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'm1', propertyId: 'p9', userId: 'u2', roleType: 'Inquilino', status: 'linked', isPrimaryContact: false, linkedAt: '2026-01-01' });
      await settle();

      expect(reloadSpy).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/c/properties/p9');
    });

    it('si recargar la sesión falla, la vinculación ya está hecha: navega igual', async () => {
      await setupReady(makeUser({ id: 'u2', role: 'C' }));
      vi.spyOn(h.auth, 'reloadSession').mockRejectedValueOnce(new Error('refresh caducado'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Aceptar invitación'))!.click();
      h.http.expectOne(`${API}/membership-invites/tok-valido/redeem`)
        .flush({ id: 'm1', propertyId: 'p9', userId: 'u2', roleType: 'Inquilino', status: 'linked', isPrimaryContact: false, linkedAt: '2026-01-01' });
      await settle();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/c/properties/p9');
    });

    it('si el canje falla, muestra el error y no navega', async () => {
      await setupReady(makeUser({ id: 'u2', role: 'C' }));

      const acceptBtn = Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Aceptar invitación'))!;
      acceptBtn.click();

      const req = h.http.expectOne(`${API}/membership-invites/tok-valido/redeem`);
      req.flush({ message: 'Este enlace de invitación ya fue utilizado.' }, { status: 409, statusText: 'Conflict' });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Este enlace de invitación ya fue utilizado.');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });
});
