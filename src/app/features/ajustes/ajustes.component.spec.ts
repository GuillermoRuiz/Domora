import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { API, setupComponent, settle } from '../../core/testing/component-harness';
import { StateService } from '../../core/state.service';
import { AjustesComponent } from './ajustes.component';
import type { OwnAdministrator, UserMessagingSettings } from '../../core/models';

function makeSettings(overrides: Partial<UserMessagingSettings> = {}): UserMessagingSettings {
  return { allowDirectMessages: 'nobody', displayNamePolicy: 'full_name', displayAlias: '', ...overrides } as UserMessagingSettings;
}

async function flushSettings(http: any, settings: UserMessagingSettings): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/direct-messages/settings` && r.method === 'GET').flush(settings);
  await settle();
  // ngOnInit las pide en secuencia, no en paralelo — esta llega justo después.
  http.expectOne((r: any) => r.url === `${API}/notifications/preferences` && r.method === 'GET').flush([]);
  await settle();
}

describe('AjustesComponent', () => {
  it('carga los ajustes de mensajería al montar', async () => {
    const { fixture, http, el, component } = setupComponent(AjustesComponent);
    fixture.detectChanges();
    expect(el.textContent).toContain('Cargando ajustes');
    await flushSettings(http, makeSettings({ allowDirectMessages: 'anyone_linked' }));
    fixture.detectChanges();

    expect(el.querySelectorAll('select')).toHaveLength(6); // 2 de mensajería + idioma/zona/moneda/fecha
    expect(component.messagingSettings()?.allowDirectMessages).toBe('anyone_linked');
  });

  it('cambiar la política de mensajes manda solo el campo modificado (PATCH parcial, no el objeto completo)', async () => {
    const { fixture, http, el, component } = setupComponent(AjustesComponent);
    fixture.detectChanges();
    await flushSettings(http, makeSettings());
    fixture.detectChanges();

    component.setMessagingPolicy('anyone_linked');
    const req = http.expectOne((r: any) => r.url === `${API}/direct-messages/settings` && r.method === 'PATCH');
    expect(req.request.body).toEqual({ allowDirectMessages: 'anyone_linked' });
    req.flush(makeSettings({ allowDirectMessages: 'anyone_linked' }));
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('.toast')?.textContent).toContain('Ajustes actualizados');
  });

  it('si falla el guardado, revierte al valor anterior y avisa por toast', async () => {
    const { fixture, http, el, component } = setupComponent(AjustesComponent);
    fixture.detectChanges();
    await flushSettings(http, makeSettings({ allowDirectMessages: 'nobody' }));
    fixture.detectChanges();

    component.setMessagingPolicy('anyone_linked');
    const req = http.expectOne((r: any) => r.url === `${API}/direct-messages/settings` && r.method === 'PATCH');
    req.flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
    await settle();
    fixture.detectChanges();

    expect(component.messagingSettings()?.allowDirectMessages).toBe('nobody');
    expect(el.querySelector('.toast')?.textContent).toContain('No se pudieron guardar');
  });

  it('el alias se guarda solo si cambió de verdad respecto al actual', async () => {
    const { fixture, http, el, component } = setupComponent(AjustesComponent);
    fixture.detectChanges();
    await flushSettings(http, makeSettings({ displayAlias: 'Administración' }));
    fixture.detectChanges();

    component.displayAliasDraft.set('Administración'); // sin cambios reales
    component.saveDisplayAlias();
    http.expectNone((r: any) => r.method === 'PATCH');

    component.displayAliasDraft.set('Portería');
    component.saveDisplayAlias();
    const req = http.expectOne((r: any) => r.url === `${API}/direct-messages/settings` && r.method === 'PATCH');
    expect(req.request.body).toEqual({ displayAlias: 'Portería' });
    req.flush(makeSettings({ displayAlias: 'Portería' }));
  });

  describe('empresa administradora (antes una maqueta que fingía guardar)', () => {
    const OWN: OwnAdministrator = {
      id: 'a1', name: 'Gestora Real S.L.', cif: 'B12345678', vatNumber: null, phone: '+34 900 000 000',
      contactName: null, contactEmail: null, fiscalAddress: 'Calle Real 1, Madrid',
    };

    async function mount() {
      const h = setupComponent(AjustesComponent);
      h.fixture.detectChanges();
      h.http.expectOne((r: any) => r.url === `${API}/admins/me` && r.method === 'GET').flush(OWN);
      await flushSettings(h.http, makeSettings());
      h.fixture.detectChanges();
      return h;
    }

    it('muestra los datos reales de la gestora, no valores fijos', async () => {
      const { el } = await mount();

      expect(el.textContent).toContain('Gestora Real S.L.');
      expect(el.textContent).toContain('B12345678');
      expect(el.textContent).toContain('Calle Real 1, Madrid');
      expect(el.textContent).not.toContain('Gestora Mediterránea');
    });

    it('al editar, razón social, CIF y dirección fiscal no son campos editables', async () => {
      const { el, component, fixture } = await mount();

      component.startEditEmpresa();
      fixture.detectChanges();

      expect(el.querySelector('#emp-phone')).not.toBeNull();
      expect((el.querySelector('#emp-phone') as HTMLInputElement).value).toBe('');
      const inputs = Array.from(el.querySelectorAll('.form-grid input')).map((i) => i.id);
      expect(inputs).toEqual(['emp-vat', 'emp-phone', 'emp-contact-name', 'emp-contact-email']);
      expect(el.textContent).toContain('contacta con Domora');
    });

    it('la tarjeta «Datos de facturación» va justo después de la empresa y la edición de empresa remite a ella', async () => {
      const { el, component, fixture, http } = await mount();
      http.expectOne((r: any) => r.url === `${API}/admin-billing/me` && r.method === 'GET');
      const card = el.querySelector('app-billing-card');
      expect(card).not.toBeNull();
      expect(card?.previousElementSibling?.textContent).toContain('Empresa administradora');
      component.startEditEmpresa();
      fixture.detectChanges();
      expect(el.textContent).toContain('Los datos con los que te facturamos los editas en «Datos de facturación».');
    });

    it('guardar hace PATCH /admins/me con los editables (vacío = null) y muestra el resultado', async () => {
      const { el, component, fixture, http } = await mount();
      component.startEditEmpresa();
      component.empPhone.set('+34 911 111 111');
      component.empContactEmail.set('ana@gestora.test');

      const promise = component.saveEmpresa();
      const req = http.expectOne((r: any) => r.url === `${API}/admins/me` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ phone: '+34 911 111 111', contactName: null, contactEmail: 'ana@gestora.test', vatNumber: null });
      req.flush({ ...OWN, phone: '+34 911 111 111', contactEmail: 'ana@gestora.test' });
      await promise;
      fixture.detectChanges();

      expect(component.editEmpresa()).toBe(false);
      expect(el.textContent).toContain('ana@gestora.test');
      expect(el.querySelector('.toast')?.textContent).toContain('Datos de empresa actualizados');
    });

    it('si falla el guardado, no cierra la edición ni muestra un falso éxito', async () => {
      const { el, component, fixture, http } = await mount();
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      component.startEditEmpresa();

      const promise = component.saveEmpresa();
      http.expectOne((r: any) => r.url === `${API}/admins/me` && r.method === 'PATCH').flush({ message: 'x' }, { status: 500, statusText: 'Error' });
      await promise;
      fixture.detectChanges();

      expect(component.editEmpresa()).toBe(true);
      expect(el.querySelector('.toast')?.textContent).toContain('No se pudieron guardar');
    });

    it('un email de contacto inválido bloquea guardar', async () => {
      const { component, http } = await mount();
      component.startEditEmpresa();
      component.empContactEmail.set('no-es-email');

      await component.saveEmpresa();

      expect(component.empContactEmailInvalid()).toBe(true);
      http.expectNone((r: any) => r.method === 'PATCH' && r.url === `${API}/admins/me`);
    });
  });

  describe('invitar a un compañero de equipo', () => {
    it('genera el enlace de invitación al pulsar el botón', async () => {
      const { fixture, http, el } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      await flushSettings(http, makeSettings());
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Invitar a un compañero')) as HTMLElement).click();

      const req = http.expectOne((r: any) => r.url === `${API}/auth/team-invites` && r.method === 'POST');
      req.flush({ token: 'tok123' });
      await settle();
      fixture.detectChanges();

      expect(el.querySelector('.invite-link-box__value')?.textContent).toContain('/team-invite/tok123');
    });

    it('si falla la generación, muestra el error en vez de un enlace roto', async () => {
      const { fixture, http, el } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      await flushSettings(http, makeSettings());
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Invitar a un compañero')) as HTMLElement).click();
      const req = http.expectOne((r: any) => r.url === `${API}/auth/team-invites` && r.method === 'POST');
      req.flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
      await settle();
      fixture.detectChanges();

      expect(el.querySelector('.invite-link-box')).toBeNull();
      expect(el.textContent).toContain('No se pudo generar el enlace de invitación');
    });
  });

  describe('integración "Migrar desde otra plataforma"', () => {
    it('navega al asistente de migración en vez de mostrar un toast', async () => {
      const { fixture, http, el, component } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      await flushSettings(http, makeSettings());
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const row = Array.from(el.querySelectorAll('.integration-row')).find((r) => r.textContent?.includes('Migrar desde otra plataforma'));
      (row?.querySelector('app-btn button') as HTMLElement).click();

      expect(navigateSpy).toHaveBeenCalledWith(['/b/migracion']);
      expect(component.toastMessage()).toBeNull();
    });

    it('las otras integraciones sin `route` siguen mostrando el toast mock, sin navegar', async () => {
      const { fixture, http, el } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      await flushSettings(http, makeSettings());
      fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      const row = Array.from(el.querySelectorAll('.integration-row')).find((r) => r.textContent?.includes('Banca online'));
      (row?.querySelector('app-btn button') as HTMLElement).click();
      fixture.detectChanges();

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(el.querySelector('.toast')?.textContent).toContain('Redirigiendo a configuración SEPA');
    });
  });

  describe('preferencias de notificación (email por categoría)', () => {
    it('carga las preferencias reales del backend y las pinta', async () => {
      const { fixture, http, el } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      http.expectOne((r: any) => r.url === `${API}/direct-messages/settings` && r.method === 'GET').flush(makeSettings());
      await settle();
      http.expectOne((r: any) => r.url === `${API}/notifications/preferences` && r.method === 'GET').flush([
        { category: 'meeting', emailEnabled: false },
        { category: 'issue', emailEnabled: true },
      ]);
      await settle();
      fixture.detectChanges();

      expect(el.textContent).toContain('Juntas');
      expect(el.textContent).toContain('Incidencias');
      const toggles = el.querySelectorAll('.notif-row .toggle');
      expect(toggles).toHaveLength(2);
    });

    it('cambiar un toggle hace PUT con el array completo actualizado (optimista)', async () => {
      const { fixture, http, el, component } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      await flushSettings(http, makeSettings());
      component.notifPrefs.set([
        { category: 'meeting', emailEnabled: true },
        { category: 'issue', emailEnabled: true },
      ]);
      fixture.detectChanges();

      void component.toggleNotifEmail('meeting');
      expect(component.notifPrefs().find((p) => p.category === 'meeting')?.emailEnabled).toBe(false);

      const req = http.expectOne((r: any) => r.url === `${API}/notifications/preferences` && r.method === 'PUT');
      expect(req.request.body).toEqual({
        preferences: [
          { category: 'meeting', emailEnabled: false },
          { category: 'issue', emailEnabled: true },
        ],
      });
      req.flush([
        { category: 'meeting', emailEnabled: false },
        { category: 'issue', emailEnabled: true },
      ]);
      await settle();
    });

    it('si falla el guardado, revierte el toggle y avisa por toast', async () => {
      const { fixture, http, el, component } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      await flushSettings(http, makeSettings());
      component.notifPrefs.set([{ category: 'meeting', emailEnabled: true }]);
      fixture.detectChanges();

      void component.toggleNotifEmail('meeting');
      const req = http.expectOne((r: any) => r.url === `${API}/notifications/preferences` && r.method === 'PUT');
      req.flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
      await settle();
      fixture.detectChanges();

      expect(component.notifPrefs()[0].emailEnabled).toBe(true);
      expect(el.querySelector('.toast')?.textContent).toContain('No se pudieron guardar las preferencias');
    });
  });

  it('el toggle de modo oscuro delega en StateService.toggleDarkMode', async () => {
    const { fixture, http, el } = setupComponent(AjustesComponent);
    fixture.detectChanges();
    await flushSettings(http, makeSettings());
    fixture.detectChanges();
    const state = TestBed.inject(StateService);
    const before = state.darkMode();

    (el.querySelector('.theme-row .toggle') as HTMLElement).click();

    expect(state.darkMode()).toBe(!before);
  });
  describe('puesta en marcha del despacho', () => {
    const officeUrl = `${API}/completeness/office`;
    const office = (pending: string[]) => ({
      administratorId: 'a1', name: 'Despacho Gómez', office: 0, estates: 0, total: 0, estateCount: 1, onboardingComplete: false, includedInAverage: true, estateDetails: [],
      officeSteps: (['contact', 'billing', 'payment', 'estates', 'team', 'twoFactor'] as const).map((key) => ({
        key, weight: key === 'team' ? 'info' : key === 'contact' || key === 'twoFactor' ? 'recommended' : 'required', status: pending.includes(key) ? 'pending' : 'done',
      })),
    });

    it('aparece justo después del perfil profesional mientras falten pasos', async () => {
      const { fixture, http, el } = setupComponent(AjustesComponent);
      fixture.detectChanges();
      http.expectOne(officeUrl).flush(office(['payment']));
      await flushSettings(http, makeSettings());
      fixture.detectChanges();

      const card = el.querySelector('app-office-setup');
      expect(card?.textContent).toContain('Puesta en marcha del despacho');
      expect(card?.previousElementSibling?.textContent).toContain('Perfil profesional');
      expect(card?.querySelector('[data-step="payment"]')?.getAttribute('data-status')).toBe('pending');
    });

    it('un enlace con fragmento (#ajustes-equipo) hace scroll hasta esa sección', async () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      const { fixture, http, el } = setupComponent(AjustesComponent, { providers: [{ provide: ActivatedRoute, useValue: { fragment: of('ajustes-equipo') } }] });
      fixture.detectChanges();
      http.match(officeUrl).forEach((r) => r.flush(office([])));
      await flushSettings(http, makeSettings());
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(el.querySelector('#ajustes-equipo'));
    });

    it('si falla no hay tarjeta y el resto de Ajustes sigue funcionando', async () => {
      const { fixture, http, el } = setupComponent(AjustesComponent);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      fixture.detectChanges();
      http.expectOne(officeUrl).flush({}, { status: 500, statusText: 'Error' });
      await flushSettings(http, makeSettings());
      fixture.detectChanges();

      expect(el.querySelector('.office-setup')).toBeNull();
      expect(el.textContent).toContain('Perfil profesional');
      expect(error).toHaveBeenCalled();
    });
  });
});
