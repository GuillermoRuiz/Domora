import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { StateService } from './core/state.service';
import { setupComponent, makeUser, settle, API } from './core/testing/component-harness';

describe('App', () => {
  it('carga el estado global una vez sin montar una cabecera central ni consultar conversaciones duplicadas', async () => {
    const { fixture, el, http } = setupComponent(App, { user: makeUser({ role: 'B' }) });
    fixture.detectChanges();
    http.expectOne(`${API}/notifications/summary`).flush({ unreadMessages: 2, unreadNotifications: 1 });
    http.expectNone(`${API}/alerts`);
    // Puesta en marcha del despacho (rol B): una sola petición para el punto del menú de cuenta.
    http.expectOne(`${API}/completeness/office`).flush({ officeSteps: [] });
    await settle(); fixture.detectChanges();
    expect(TestBed.inject(StateService).unreadMessagesCount()).toBe(2);
    expect(el.querySelector('app-topbar')).toBeNull();
    http.expectNone(`${API}/direct-messages/conversations`);
    http.expectNone(`${API}/estates`);
    http.verify();
  });
  it('sin sesión, solo pinta el router-outlet — sin sidebar ni role-switcher', () => {
    const { fixture, el } = setupComponent(App);
    fixture.detectChanges();

    expect(el.querySelector('.app-shell')).toBeNull();
    expect(el.querySelector('app-sidebar')).toBeNull();
    expect(el.querySelector('.role-switcher')).toBeNull();
  });

  it('con sesión, pinta el shell completo: sidebar y footer legal (sin selector de rol cuando mockRoleSwitch es false, como en prod/demo)', () => {
    const { fixture, el, component } = setupComponent(App, { user: makeUser() });
    // El runner de tests usa environment.development (mockRoleSwitch: true): se fuerza el valor de prod.
    component.showRoleSwitcher = false;
    fixture.detectChanges();

    expect(el.querySelector('.app-shell')).not.toBeNull();
    expect(el.querySelector('app-sidebar')).not.toBeNull();
    expect(el.querySelector('.role-switcher')).toBeNull();
    expect(el.querySelector('app-footer')).toBeNull();
  });

  it('el selector de rol solo aparece cuando showRoleSwitcher (environment.mockRoleSwitch) está activo', () => {
    const { fixture, el, component } = setupComponent(App, { user: makeUser() });
    component.showRoleSwitcher = true;
    fixture.detectChanges();

    expect(el.querySelector('.role-switcher')).not.toBeNull();
  });

  it('sin build demo no hay banner de demostración', () => {
    const { fixture, el, component } = setupComponent(App, { user: makeUser() });
    fixture.detectChanges();

    expect(component.demoBanner).toBeNull();
    expect(el.querySelector('app-demo-banner')).toBeNull();
    expect(el.textContent).not.toContain('Entorno de demostración');
  });

  it('con un demoBanner (build demo) lo monta tanto con sesión como sin ella', async () => {
    const { DemoBannerComponent } = await import('./shared/components/demo-banner/demo-banner.component');
    for (const user of [makeUser(), null]) {
      TestBed.resetTestingModule();
      const { fixture, el, component } = setupComponent(App, { user });
      component.demoBanner = DemoBannerComponent;
      fixture.detectChanges();

      expect(el.querySelector('app-demo-banner')).not.toBeNull();
      expect(el.textContent).toContain('Entorno de demostración');
      fixture.destroy();
    }
  });

  describe('subscriptionBanner', () => {
    it('rol B en periodo de gracia, muestra un aviso de advertencia (no de peligro)', () => {
      const { fixture, el } = setupComponent(App, { user: makeUser({ role: 'B', subscriptionStatus: 'Periodo de gracia' }) });
      fixture.detectChanges();

      const banner = el.querySelector('.subscription-banner');
      expect(banner).not.toBeNull();
      expect(banner?.className).not.toContain('subscription-banner--danger');
      expect(banner?.textContent).toContain('periodo de gracia');
    });

    it('rol B con la suscripción vencida, muestra el aviso de peligro', () => {
      const { fixture, el } = setupComponent(App, { user: makeUser({ role: 'B', subscriptionStatus: 'Vencida' }) });
      fixture.detectChanges();

      const banner = el.querySelector('.subscription-banner');
      expect(banner?.className).toContain('subscription-banner--danger');
      expect(banner?.textContent).toContain('vencida');
    });

    it('rol B con la cuenta bloqueada, muestra el aviso de peligro', () => {
      const { fixture, el } = setupComponent(App, { user: makeUser({ role: 'B', subscriptionStatus: 'Bloqueada' }) });
      fixture.detectChanges();

      expect(el.querySelector('.subscription-banner--danger')).not.toBeNull();
      expect(el.textContent).toContain('suspendida');
    });

    it('rol B con la suscripción activa, no muestra ningún aviso', () => {
      const { fixture, el } = setupComponent(App, { user: makeUser({ role: 'B', subscriptionStatus: 'Activa' }) });
      fixture.detectChanges();

      expect(el.querySelector('.subscription-banner')).toBeNull();
    });

    it('roles A y C nunca muestran el aviso, aunque el usuario tuviera subscriptionStatus', () => {
      const { fixture, el } = setupComponent(App, { user: makeUser({ role: 'C', subscriptionStatus: 'Vencida' }) });
      fixture.detectChanges();

      expect(el.querySelector('.subscription-banner')).toBeNull();
    });
  });

  it('"Ver suscripción" navega a /b/subscription', () => {
    const { fixture, el } = setupComponent(App, { user: makeUser({ role: 'B', subscriptionStatus: 'Vencida' }) });
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    (el.querySelector('.subscription-banner__action') as HTMLButtonElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/b/subscription']);
  });

  it('el modal de alta de propiedad solo se monta si showAddPropertyModal está activo', () => {
    const { fixture, el } = setupComponent(App, { user: makeUser() });
    fixture.detectChanges();
    expect(el.querySelector('app-add-property')).toBeNull();

    TestBed.inject(StateService).showAddPropertyModal.set(true);
    fixture.detectChanges();

    expect(el.querySelector('app-add-property')).not.toBeNull();
  });
  describe('despacho scope band (role A, odd/tasks/role-a-panel.md S1)', () => {
    afterEach(() => sessionStorage.clear());

    it('role A with a selected despacho sees the band above the page', () => {
      sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'a1', id: 'd1', name: 'Fincas García' }));
      const { fixture, el, http } = setupComponent(App, { user: makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null }) });
      fixture.detectChanges();
      TestBed.tick();
      http.match(() => true).forEach((req) => req.flush(req.request.url.endsWith('/support-sessions/active') ? [] : {}));
      fixture.detectChanges();
      expect(el.querySelector('.app-main .scope-band')?.textContent).toContain('Viendo: Fincas García');
    });

    it('role B never sees it (shell unchanged)', () => {
      sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'u1', id: 'd1', name: 'Fincas García' }));
      const { fixture, el } = setupComponent(App, { user: makeUser({ role: 'B' }) });
      fixture.detectChanges();
      expect(el.querySelector('.scope-band')).toBeNull();
      expect(el.querySelector('app-sidebar')).not.toBeNull();
    });
  });
});
