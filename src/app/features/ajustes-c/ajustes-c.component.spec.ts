import { API, setupComponent, settle, makeUser } from '../../core/testing/component-harness';
import { AjustesCComponent } from './ajustes-c.component';
import type { MembershipSettings, PropertyView, OwnerProperty } from '../../core/models';

function makeMembership(propertyId: string, estateId: string | null = 'e1'): any {
  return { id: `m-${propertyId}`, propertyId, userId: 'u1', property: { estateId } };
}

function makeProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return { id: 'p1', type: 'Piso', estateId: 'e1', administratorId: 'a1', status: 'Ocupado', quotaMonthly: 100, balance: 0, pendingDocs: 0, openIssues: 0, ...overrides } as OwnerProperty;
}

function makePropertyView(overrides: Partial<PropertyView> = {}): PropertyView {
  return {
    property: makeProperty(), estate: null, admin: null, adminContact: null, membership: null,
    estateName: 'Edificio Sol', adminName: null, adminContactName: null, nickname: 'Mi piso',
    viewerRoleType: 'Propietario', isLinked: true, linkageStatus: 'linked', addressFull: 'Calle Mayor 1',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<MembershipSettings> = {}): MembershipSettings {
  return {
    visibleInDirectory: true, showPhoneInDirectory: false, showEmailInDirectory: false, visibleInBookings: true,
    allowDirectMessages: 'nobody', displayNamePolicy: 'full_name', displayAlias: '',
    notifyIssues: 'email_push', notifyReceipts: 'email_push',
    notifyCommunications: 'email_push', notifyBookings: 'none', notifyDirectMessages: 'push_only',
    ...overrides,
  };
}

describe('AjustesCComponent', () => {
  it('sin propiedades vinculadas a una finca, no carga ajustes y lo muestra honestamente', async () => {
    const { fixture, http, el } = setupComponent(AjustesCComponent, { user: makeUser() });
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/users/u1/memberships`).flush([]);
    await settle();
    fixture.detectChanges();

    expect(el.textContent).toContain('No se han podido cargar los ajustes de esta propiedad');
    http.expectNone((r: any) => r.url.includes('/memberships/me/settings'));
  });

  it('con una única propiedad, carga sus ajustes automáticamente sin mostrar el selector', async () => {
    const { fixture, http, el } = setupComponent(AjustesCComponent, { user: makeUser() });
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/users/u1/memberships`).flush([makeMembership('p1')]);
    await settle();
    http.expectOne((r: any) => r.url === `${API}/properties/p1/view`).flush(makePropertyView());
    await settle();
    http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings`).flush(makeSettings());
    await settle();
    fixture.detectChanges();

    expect(el.textContent).not.toContain('Propiedad');
    expect(el.querySelectorAll('app-toggle').length).toBeGreaterThan(0);
  });

  it('con varias propiedades, cambiar de propiedad en el selector recarga sus ajustes', async () => {
    const { fixture, http, el, component } = setupComponent(AjustesCComponent, { user: makeUser() });
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/users/u1/memberships`).flush([makeMembership('p1'), makeMembership('p2')]);
    await settle();
    http.expectOne((r: any) => r.url === `${API}/properties/p1/view`).flush(makePropertyView({ property: makeProperty({ id: 'p1' }), nickname: 'Piso A' }));
    http.expectOne((r: any) => r.url === `${API}/properties/p2/view`).flush(makePropertyView({ property: makeProperty({ id: 'p2' }), nickname: 'Piso B' }));
    await settle();
    http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings`).flush(makeSettings({ visibleInDirectory: true }));
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('select')).not.toBeNull();

    const selectPromise = component.onSelectProperty('p2');
    http.expectOne((r: any) => r.url === `${API}/properties/p2/memberships/me/settings`).flush(makeSettings({ visibleInDirectory: false }));
    await selectPromise;
    fixture.detectChanges();

    expect(component.settings()?.visibleInDirectory).toBe(false);
  });

  describe('con los ajustes ya cargados', () => {
    async function setupWithSettings(settings: MembershipSettings) {
      const harness = setupComponent(AjustesCComponent, { user: makeUser() });
      harness.fixture.detectChanges();
      harness.http.expectOne((r: any) => r.url === `${API}/users/u1/memberships`).flush([makeMembership('p1')]);
      await settle();
      harness.http.expectOne((r: any) => r.url === `${API}/properties/p1/view`).flush(makePropertyView());
      await settle();
      harness.http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings`).flush(settings);
      await settle();
      harness.fixture.detectChanges();
      return harness;
    }

    it('activar/desactivar la visibilidad en el directorio manda un PATCH parcial', async () => {
      const { fixture, http, el } = await setupWithSettings(makeSettings({ visibleInDirectory: true }));

      (el.querySelector('app-toggle .toggle') as HTMLElement).click();

      const req = http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ visibleInDirectory: false });
      req.flush(makeSettings({ visibleInDirectory: false }));
      await settle();
      fixture.detectChanges();

      expect(el.querySelector('.toast')?.textContent).toContain('Ajustes actualizados');
    });

    it('lista los canales de notificación que quedan y guardar uno manda un PATCH parcial', async () => {
      const { http, el, component } = await setupWithSettings(makeSettings());

      const labels = Array.from(el.querySelectorAll('.notif-row__label')).map((row) => row.textContent?.trim());
      expect(labels).toEqual(['Incidencias', 'Recibos y pagos', 'Comunicados, documentos y juntas', 'Reservas de zonas comunes', 'Mensajes directos de vecinos']);

      component.setNotifCategory('notifyIssues', 'email_only');
      const req = http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ notifyIssues: 'email_only' });
      req.flush(makeSettings({ notifyIssues: 'email_only' }));
      await settle();
    });

    it('si falla el guardado, revierte al valor anterior', async () => {
      const { fixture, http, el, component } = await setupWithSettings(makeSettings({ visibleInDirectory: true }));

      (el.querySelector('app-toggle .toggle') as HTMLElement).click();
      const req = http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings` && r.method === 'PATCH');
      req.flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
      await settle();
      fixture.detectChanges();

      expect(component.settings()?.visibleInDirectory).toBe(true);
      expect(el.querySelector('.toast')?.textContent).toContain('No se pudieron guardar');
    });

    it('setDirectMessagePolicy y setDisplayNamePolicy mandan el patch correcto', async () => {
      const { http, component } = await setupWithSettings(makeSettings());

      component.setDirectMessagePolicy('neighbors');
      let req = http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ allowDirectMessages: 'neighbors' });
      req.flush(makeSettings({ allowDirectMessages: 'neighbors' }));
      await settle();

      component.setDisplayNamePolicy('alias');
      req = http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ displayNamePolicy: 'alias' });
      req.flush(makeSettings({ allowDirectMessages: 'neighbors', displayNamePolicy: 'alias' }));
    });

    it('el alias solo se guarda si cambió respecto al actual', async () => {
      const { http, component } = await setupWithSettings(makeSettings({ displayAlias: 'Portería' }));

      component.displayAliasDraft.set('Portería');
      component.saveDisplayAlias();
      http.expectNone((r: any) => r.method === 'PATCH');

      component.displayAliasDraft.set('El de arriba');
      component.saveDisplayAlias();
      const req = http.expectOne((r: any) => r.url === `${API}/properties/p1/memberships/me/settings` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ displayAlias: 'El de arriba' });
      req.flush(makeSettings({ displayAlias: 'El de arriba' }));
    });
  });
});
