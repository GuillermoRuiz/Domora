import { API, makeUser, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { MembershipsMessagingService } from './memberships-messaging.service';

describe('MembershipsMessagingService', () => {
  let h: ApiServiceHarness<MembershipsMessagingService>;

  beforeEach(() => {
    h = setupApiService(MembershipsMessagingService);
  });

  afterEach(() => h.http.verify());

  describe('currentUserId (helper puro)', () => {
    it('devuelve el id del usuario en sesión', () => {
      h.setCurrentUser(makeUser({ id: 'u-sesion' }));
      expect(h.service.currentUserId()).toBe('u-sesion');
    });

    it('sin sesión, devuelve cadena vacía en vez de undefined/null', () => {
      h.setCurrentUser(null);
      expect(h.service.currentUserId()).toBe('');
    });
  });

  describe('resolveUserName (helper puro)', () => {
    it('si viene apiName, se usa directo sin mirar nada más', () => {
      expect(h.service.resolveUserName('cualquier-id', 'fallback', 'Nombre de la API')).toBe('Nombre de la API');
    });

    it('sin userId, devuelve el fallback', () => {
      expect(h.service.resolveUserName(null, 'Sistema')).toBe('Sistema');
      expect(h.service.resolveUserName(undefined, 'Sistema')).toBe('Sistema');
    });

    it('si el userId es el del usuario en sesión, devuelve su propio nombre', () => {
      h.setCurrentUser(makeUser({ id: 'u1', fullName: 'Ana Gestora' }));
      expect(h.service.resolveUserName('u1', 'fallback')).toBe('Ana Gestora');
    });

    it('para cualquier otro userId sin apiName, cae al fallback (no hay lookup real)', () => {
      h.setCurrentUser(makeUser({ id: 'u1', fullName: 'Ana Gestora' }));
      expect(h.service.resolveUserName('otro-usuario', 'Sistema')).toBe('Sistema');
    });
  });

  describe('Users (endpoints todavía no existentes en el backend)', () => {
    it('findUserById devuelve siempre null', async () => {
      expect(await h.service.findUserById('u1')).toBeNull();
      h.http.expectNone(() => true);
    });
    it('findUserByEmail devuelve siempre null', async () => {
      expect(await h.service.findUserByEmail('x@x.com')).toBeNull();
      h.http.expectNone(() => true);
    });
    it('findUserByTaxId devuelve siempre null', async () => {
      expect(await h.service.findUserByTaxId('ES', '12345678A')).toBeNull();
      h.http.expectNone(() => true);
    });
  });

  describe('Property memberships', () => {
    it('listMembershipsByProperty — GET simple', async () => {
      const promise = h.service.listMembershipsByProperty('p1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships`);
      req.flush([{ id: 'm1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario', status: 'linked', isPrimaryContact: true, linkedAt: '2026-01-01' }]);
      expect((await promise)).toHaveLength(1);
    });

    it('listMembershipsByUser usa el userId dado si se indica', async () => {
      const promise = h.service.listMembershipsByUser('u-explicito');
      const req = h.http.expectOne(`${API}/users/u-explicito/memberships`);
      req.flush([]);
      await promise;
    });

    it('listMembershipsByUser sin userId, usa el usuario en sesión', async () => {
      h.setCurrentUser(makeUser({ id: 'u-sesion' }));
      const promise = h.service.listMembershipsByUser();
      const req = h.http.expectOne(`${API}/users/u-sesion/memberships`);
      req.flush([]);
      await promise;
    });

    it('listMembershipsByUser sin sesión y sin userId, pide para el id vacío (comportamiento actual del servicio)', async () => {
      h.setCurrentUser(null);
      const promise = h.service.listMembershipsByUser();
      const req = h.http.expectOne(`${API}/users//memberships`);
      req.flush([]);
      await promise;
    });

    it('findPrimaryContact devuelve membership+user', async () => {
      const promise = h.service.findPrimaryContact('p1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/primary-contact`);
      req.flush({ id: 'm1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario', status: 'linked', isPrimaryContact: true, linkedAt: '2026-01-01', user: { id: 'u1', fullName: 'Ana' } });
      const result = await promise;
      expect(result?.user.fullName).toBe('Ana');
    });

    it('findPrimaryContact devuelve null si no hay ninguno', async () => {
      const promise = h.service.findPrimaryContact('p1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/primary-contact`);
      req.flush(null);
      expect(await promise).toBeNull();
    });

    it('findPrimaryContact devuelve null si falla', async () => {
      const promise = h.service.findPrimaryContact('p1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/primary-contact`);
      req.flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
      expect(await promise).toBeNull();
    });

    it('get/updateMembershipSettings — GET y PATCH sobre "me/settings"', async () => {
      const getPromise = h.service.getMembershipSettings('p1');
      h.http.expectOne(`${API}/properties/p1/memberships/me/settings`).flush({ visibleInDirectory: true, showPhoneInDirectory: false, showEmailInDirectory: false, visibleInBookings: true, allowDirectMessages: 'neighbors', displayNamePolicy: 'full_name', notifyIssues: 'email_push', notifyReceipts: 'email_push' });
      expect((await getPromise).visibleInDirectory).toBe(true);

      const patchPromise = h.service.updateMembershipSettings('p1', { visibleInDirectory: false });
      const patchReq = h.http.expectOne(`${API}/properties/p1/memberships/me/settings`);
      expect(patchReq.request.method).toBe('PATCH');
      expect(patchReq.request.body).toEqual({ visibleInDirectory: false });
      patchReq.flush({ visibleInDirectory: false });
      await patchPromise;
    });

    it('createMembershipInvite — POST con roleType + email, devuelve enlace y QR construidos en el backend', async () => {
      const promise = h.service.createMembershipInvite('p1', 'Inquilino', 'luis@example.com');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/invites`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ roleType: 'Inquilino', inviteeEmail: 'luis@example.com' });
      req.flush({ inviteUrl: 'https://x/membership-invite/abc', qrDataUrl: 'data:image/png;base64,QR' });
      expect(await promise).toEqual({ inviteUrl: 'https://x/membership-invite/abc', qrDataUrl: 'data:image/png;base64,QR' });
    });

    it('createOwnerInvite — POST a owner-invites con solo el titular (el email lo pone el backend)', async () => {
      const promise = h.service.createOwnerInvite('p1', 'eo1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/owner-invites`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ externalOwnerId: 'eo1' });
      req.flush({ inviteUrl: 'u', qrDataUrl: 'q' });
      await promise;
    });

    it('listPendingInvites — GET de las invitaciones de la propiedad', async () => {
      const promise = h.service.listPendingInvites('p1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/invites`);
      expect(req.request.method).toBe('GET');
      req.flush([{ id: 'i1', roleType: 'Inquilino', inviteeEmail: 'a@b.c', status: 'pending', expiresAt: '2026-10-01', lastSentAt: null, createdAt: '2026-09-24' }]);
      expect(await promise).toHaveLength(1);
    });

    it('resendMembershipInvite — POST a /resend de esa invitación', async () => {
      const promise = h.service.resendMembershipInvite('p1', 'i1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/invites/i1/resend`);
      expect(req.request.method).toBe('POST');
      req.flush({ inviteUrl: 'u', qrDataUrl: 'q' });
      await promise;
    });

    it('revokeMembershipInvite — PATCH a /revoke de esa invitación', async () => {
      const promise = h.service.revokeMembershipInvite('p1', 'i1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/invites/i1/revoke`);
      expect(req.request.method).toBe('PATCH');
      req.flush(null);
      await promise;
    });

    it('getMembershipInviteInfo — GET simple por token', async () => {
      const promise = h.service.getMembershipInviteInfo('tok-1');
      const req = h.http.expectOne(`${API}/membership-invites/tok-1`);
      req.flush({ roleType: 'Inquilino', propertyAddress: 'Calle Mayor 3', estateName: 'Residencial Sol' });
      expect(await promise).toEqual({ roleType: 'Inquilino', propertyAddress: 'Calle Mayor 3', estateName: 'Residencial Sol' });
    });

    it('redeemMembershipInvite — POST sin body relevante', async () => {
      const promise = h.service.redeemMembershipInvite('tok-1');
      const req = h.http.expectOne(`${API}/membership-invites/tok-1/redeem`);
      expect(req.request.method).toBe('POST');
      req.flush({ id: 'm-nueva', propertyId: 'p1', userId: 'u1', roleType: 'Inquilino', status: 'linked', isPrimaryContact: false, linkedAt: '2026-01-01' });
      expect((await promise).status).toBe('linked');
    });

    it('revokeMembership — PATCH con promoteMembershipId cuando se indica', async () => {
      const promise = h.service.revokeMembership('p1', 'm1', 'm2');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/m1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ promoteMembershipId: 'm2' });
      req.flush({ id: 'm1', propertyId: 'p1', userId: 'u1', roleType: 'Inquilino', status: 'revoked', isPrimaryContact: false, linkedAt: '2026-01-01' });
      expect((await promise).status).toBe('revoked');
    });

    it('revokeMembership sin promoteMembershipId, lo manda como undefined', async () => {
      const promise = h.service.revokeMembership('p1', 'm1');
      const req = h.http.expectOne(`${API}/properties/p1/memberships/m1`);
      expect(req.request.body).toEqual({ promoteMembershipId: undefined });
      req.flush({ id: 'm1', propertyId: 'p1', userId: 'u1', roleType: 'Inquilino', status: 'revoked', isPrimaryContact: false, linkedAt: '2026-01-01' });
      await promise;
    });
  });

  describe('Mensajería directa', () => {
    it('listMessageContacts — GET simple', async () => {
      const promise = h.service.listMessageContacts();
      h.http.expectOne(`${API}/direct-messages/contacts`).flush([{ userId: 'u2', displayName: 'Vecino', estateId: 'e1' }]);
      expect((await promise)).toHaveLength(1);
    });

    it('listConversations — GET simple', async () => {
      const promise = h.service.listConversations();
      h.http.expectOne(`${API}/direct-messages/conversations`).flush([]);
      await promise;
    });

    it('listConversationMessages pasa limit/before como query params', async () => {
      const promise = h.service.listConversationMessages('c1', { limit: 20, before: '2026-01-01' });
      const req = h.http.expectOne((r) => r.url === `${API}/direct-messages/conversations/c1/messages` && r.params.get('limit') === '20' && r.params.get('before') === '2026-01-01');
      req.flush([]);
      await promise;
    });

    it('sendDirectMessage manda el payload tal cual', async () => {
      const promise = h.service.sendDirectMessage({ conversationId: 'c1', text: 'Hola' });
      const req = h.http.expectOne(`${API}/direct-messages/messages`);
      expect(req.request.body).toEqual({ conversationId: 'c1', text: 'Hola' });
      req.flush({ id: 'msg1', conversationId: 'c1', senderId: 'u1', text: 'Hola', createdAt: '2026-01-01' });
      await promise;
    });

    it('markConversationRead — PATCH sin cuerpo relevante', async () => {
      const promise = h.service.markConversationRead('c1');
      const req = h.http.expectOne(`${API}/direct-messages/conversations/c1/read`);
      expect(req.request.method).toBe('PATCH');
      req.flush(null);
      await promise;
    });

    it('get/updateMyMessagingSettings — GET y PATCH', async () => {
      const getPromise = h.service.getMyMessagingSettings();
      h.http.expectOne(`${API}/direct-messages/settings`).flush({ allowDirectMessages: 'nobody', displayNamePolicy: 'alias' });
      expect((await getPromise).allowDirectMessages).toBe('nobody');

      const patchPromise = h.service.updateMyMessagingSettings({ allowDirectMessages: 'neighbors' });
      const patchReq = h.http.expectOne(`${API}/direct-messages/settings`);
      expect(patchReq.request.body).toEqual({ allowDirectMessages: 'neighbors' });
      patchReq.flush({ allowDirectMessages: 'neighbors', displayNamePolicy: 'alias' });
      await patchPromise;
    });
  });

  describe('User representations', () => {
    it('listActiveRepresentationsFor — GET simple', async () => {
      const promise = h.service.listActiveRepresentationsFor('u1');
      h.http.expectOne(`${API}/users/u1/representations/active`).flush([]);
      await promise;
    });

    it('canActOnBehalfOf extrae el booleano canAct de la respuesta envuelta', async () => {
      const promise = h.service.canActOnBehalfOf('u1', 'u2', { estateId: 'e1' });
      const req = h.http.expectOne((r) => r.url === `${API}/users/u1/representations/can-act-on-behalf-of/u2` && r.params.get('estateId') === 'e1');
      req.flush({ canAct: true });
      expect(await promise).toBe(true);
    });

    it('canActOnBehalfOf sin opts, no manda ningún query param', async () => {
      const promise = h.service.canActOnBehalfOf('u1', 'u2');
      const req = h.http.expectOne((r) => r.url === `${API}/users/u1/representations/can-act-on-behalf-of/u2` && r.params.keys().length === 0);
      req.flush({ canAct: false });
      expect(await promise).toBe(false);
    });
  });
});
