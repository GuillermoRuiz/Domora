import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { makeUser } from '../../../core/testing/data-service-harness';
import { MembersSectionComponent } from './members-section.component';
import type { AuthenticatedUser } from '../../../core/auth.service';
import type { PendingMembershipInvite, PropertyMembership } from '../../../core/models';

function makeMembership(overrides: Partial<PropertyMembership> = {}): PropertyMembership {
  return {
    id: 'm1', propertyId: 'p1', userId: 'u1', roleType: 'Propietario', status: 'linked',
    isPrimaryContact: true, linkedAt: '2026-01-01',
    user: { id: 'u1', fullName: 'Ana García' } as any,
    ...overrides,
  };
}

function makeInvite(overrides: Partial<PendingMembershipInvite> = {}): PendingMembershipInvite {
  return {
    id: 'inv1', roleType: 'Inquilino', inviteeEmail: 'luis@example.com', status: 'pending',
    expiresAt: '2026-10-01T10:00:00Z', lastSentAt: '2026-09-24T10:00:00Z', createdAt: '2026-09-24T10:00:00Z',
    ...overrides,
  };
}

// Por defecto: rol C, usuario u1 — que en `makeMembership()` es el titular principal.
const OWNER = makeUser({ id: 'u1', role: 'C', estateIds: [], administratorId: null });
const MANAGER = makeUser({ id: 'gestora-1', role: 'B' });

const INVITES_URL = `${API}/properties/p1/memberships/invites`;

/**
 * Piloto "inteligente": `MembershipsMessagingService` real (peticiones
 * capturadas por `HttpTestingController`). El componente usa `OnInit` (no
 * `OnChanges`) a propósito — asignar `@Input` directo antes del primer
 * `detectChanges()` no dispara `ngOnChanges` en este harness, mismo motivo
 * documentado en `documentos-tab`/`personal-tab`.
 *
 * El `AuthService` del harness es una función plana, no un signal: el
 * usuario se fija al crear el componente (opción `user`), no después.
 */
describe('MembersSectionComponent', () => {
  let h: ComponentHarness<MembersSectionComponent>;

  function setup(
    overrides: Partial<Pick<MembersSectionComponent, 'canInvite' | 'canRevoke' | 'showInvites'>> = {},
    user: AuthenticatedUser = OWNER,
  ): void {
    h = setupComponent(MembersSectionComponent, { user });
    h.component.propertyId = 'p1';
    Object.assign(h.component, overrides);
  }

  afterEach(() => h.http.verify());

  /** Miembros primero; las invitaciones pendientes solo se piden si se puede invitar (dependen de saber si soy titular). */
  async function flushInitial(members: PropertyMembership[], invites?: PendingMembershipInvite[]): Promise<void> {
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/properties/p1/memberships`).flush(members);
    await settle();
    if (invites) {
      h.http.expectOne(INVITES_URL).flush(invites);
      await settle();
    }
    h.fixture.detectChanges();
  }

  function buttonWithText(text: string): HTMLButtonElement | undefined {
    return Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
  }

  it('muestra el estado vacío sin miembros', async () => {
    setup();
    await flushInitial([]);

    expect(h.el.textContent).toContain('Todavía no hay miembros');
  });

  it('pinta cada miembro con su rol, estado y badge de titular', async () => {
    setup();
    await flushInitial([
      makeMembership({ id: 'm1', roleType: 'Propietario', isPrimaryContact: true, user: { id: 'u1', fullName: 'Ana García' } as any }),
      makeMembership({ id: 'm2', roleType: 'Inquilino', isPrimaryContact: false, userId: 'u2', user: { id: 'u2', fullName: 'Luis Inquilino' } as any }),
    ]);

    expect(h.el.textContent).toContain('Ana García');
    expect(h.el.textContent).toContain('Luis Inquilino');
    expect(h.el.textContent).toContain('Titular');
  });

  describe('permisos efectivos (canInvite/canRevoke cruzados con quién puede gestionar)', () => {
    it('sin canInvite, no muestra el botón de invitar ni pide invitaciones pendientes', async () => {
      setup({ canInvite: false });
      await flushInitial([makeMembership()]);

      expect(buttonWithText('Invitar inquilino')).toBeUndefined();
      h.http.expectNone(INVITES_URL);
    });

    it('titular principal con canInvite: muestra el botón y carga las invitaciones pendientes', async () => {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], []);

      expect(buttonWithText('Invitar inquilino')).toBeDefined();
    });

    it('cotitular NO principal con canInvite: no ofrece invitar (antes veía el botón y recibía un 403)', async () => {
      setup({ canInvite: true, canRevoke: true });
      await flushInitial([
        makeMembership({ id: 'm-otro', userId: 'otro', isPrimaryContact: true }),
        makeMembership({ id: 'm-yo', userId: 'u1', isPrimaryContact: false, roleType: 'Propietario' }),
      ]);

      expect(buttonWithText('Invitar inquilino')).toBeUndefined();
      expect(h.el.querySelector('[title="Revocar"]')).toBeNull();
      h.http.expectNone(INVITES_URL);
    });

    it('showInvites: la gestora ve y gestiona las pendientes (p. ej. de propietarios importados) sin el botón de invitar inquilino', async () => {
      setup({ canInvite: false, showInvites: true }, MANAGER);
      await flushInitial([makeMembership()], [makeInvite({ roleType: 'Propietario', inviteeEmail: 'titular@example.com' })]);

      expect(buttonWithText('Invitar inquilino')).toBeUndefined();
      expect(h.el.textContent).toContain('Invitaciones pendientes');
      expect(h.el.textContent).toContain('titular@example.com');
      expect(buttonWithText('Reenviar')).toBeDefined();
    });

    it('showInvites no se salta el permiso: un vecino que no es titular principal no las ve', async () => {
      setup({ showInvites: true });
      await flushInitial([makeMembership({ userId: 'otro', isPrimaryContact: true })]);

      h.http.expectNone(INVITES_URL);
    });

    it('gestora (rol B) puede gestionar aunque no sea miembro de la propiedad', async () => {
      setup({ canInvite: true, canRevoke: true }, MANAGER);
      await flushInitial([makeMembership({ userId: 'u1', isPrimaryContact: true })], []);

      expect(buttonWithText('Invitar inquilino')).toBeDefined();
      expect(h.el.querySelector('[title="Revocar"]')).not.toBeNull();
    });
  });

  describe('invitar por email', () => {
    async function openModal(): Promise<void> {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], []);
      buttonWithText('Invitar inquilino')!.click();
      h.fixture.detectChanges();
    }

    it('el botón de enviar queda deshabilitado hasta que el email es válido', async () => {
      await openModal();
      expect(buttonWithText('Enviar invitación')!.disabled).toBe(true);

      h.component.inviteEmail.set('no-es-un-email');
      h.fixture.detectChanges();
      expect(buttonWithText('Enviar invitación')!.disabled).toBe(true);

      h.component.inviteEmail.set('luis@example.com');
      h.fixture.detectChanges();
      expect(buttonWithText('Enviar invitación')!.disabled).toBe(false);
    });

    it('envía rol + email, confirma el envío y deja el enlace y el QR como canal de respaldo', async () => {
      await openModal();
      h.component.inviteEmail.set('  luis@example.com ');
      h.fixture.detectChanges();

      buttonWithText('Enviar invitación')!.click();

      const req = h.http.expectOne(INVITES_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ roleType: 'Inquilino', inviteeEmail: 'luis@example.com' });
      req.flush({ inviteUrl: 'https://app.domora.test/membership-invite/tok-123', qrDataUrl: 'data:image/png;base64,QR' });
      await settle();

      // Tras crear, recarga la lista de pendientes.
      h.http.expectOne(INVITES_URL).flush([makeInvite()]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Invitación enviada por email a luis@example.com');
      const linkInput = h.el.querySelector('input[readonly]') as HTMLInputElement;
      expect(linkInput.value).toBe('https://app.domora.test/membership-invite/tok-123');
      const qr = h.el.querySelector('img.success-block__qr') as HTMLImageElement;
      expect(qr.getAttribute('src')).toBe('data:image/png;base64,QR');
    });

    it('si la creación falla, avisa y no muestra el bloque de éxito', async () => {
      await openModal();
      h.component.inviteEmail.set('luis@example.com');
      h.fixture.detectChanges();

      buttonWithText('Enviar invitación')!.click();
      h.http.expectOne(INVITES_URL).flush({ message: 'Prohibido' }, { status: 403, statusText: 'Forbidden' });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('No se pudo generar la invitación');
      expect(h.el.querySelector('img.success-block__qr')).toBeNull();
    });
  });

  describe('invitaciones pendientes', () => {
    it('lista cada invitación con su email y su estado legible', async () => {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], [
        makeInvite({ id: 'i1', inviteeEmail: 'a@example.com', status: 'pending' }),
        makeInvite({ id: 'i2', inviteeEmail: 'b@example.com', status: 'expiring_soon' }),
        makeInvite({ id: 'i3', inviteeEmail: 'c@example.com', status: 'expired' }),
        makeInvite({ id: 'i4', inviteeEmail: 'd@example.com', status: 'revoked' }),
      ]);

      const text = h.el.textContent ?? '';
      expect(text).toContain('Invitaciones pendientes');
      for (const label of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'Pendiente', 'Caduca pronto', 'Caducada', 'Revocada']) {
        expect(text).toContain(label);
      }
    });

    it('una invitación revocada no ofrece reenviar ni revocar', async () => {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], [makeInvite({ status: 'revoked' })]);

      expect(buttonWithText('Reenviar')).toBeUndefined();
    });

    it('sin invitaciones pendientes, no pinta la sección', async () => {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], []);

      expect(h.el.textContent).not.toContain('Invitaciones pendientes');
    });

    it('reenviar llama al endpoint de la invitación y recarga la lista', async () => {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], [makeInvite({ id: 'inv1', status: 'expired' })]);

      buttonWithText('Reenviar')!.click();

      const req = h.http.expectOne(`${INVITES_URL}/inv1/resend`);
      expect(req.request.method).toBe('POST');
      req.flush({ inviteUrl: 'https://x/membership-invite/nuevo', qrDataUrl: 'data:image/png;base64,QR' });
      await settle();

      h.http.expectOne(INVITES_URL).flush([makeInvite({ id: 'inv1', status: 'pending' })]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Invitación reenviada a luis@example.com');
    });

    it('revocar pide confirmación y, confirmado, llama al endpoint y recarga', async () => {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], [makeInvite({ id: 'inv1' })]);

      vi.spyOn(window, 'confirm').mockReturnValue(true);
      Array.from(h.el.querySelectorAll('.invite-row__actions button')).find((b) => b.textContent?.includes('Revocar'))!
        .dispatchEvent(new Event('click'));

      const req = h.http.expectOne(`${INVITES_URL}/inv1/revoke`);
      expect(req.request.method).toBe('PATCH');
      req.flush(null);
      await settle();

      h.http.expectOne(INVITES_URL).flush([makeInvite({ id: 'inv1', status: 'revoked' })]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Invitación revocada');
    });

    it('revocar sin confirmación no manda ninguna petición', async () => {
      setup({ canInvite: true });
      await flushInitial([makeMembership()], [makeInvite({ id: 'inv1' })]);

      vi.spyOn(window, 'confirm').mockReturnValue(false);
      Array.from(h.el.querySelectorAll('.invite-row__actions button')).find((b) => b.textContent?.includes('Revocar'))!
        .dispatchEvent(new Event('click'));

      h.http.expectNone(`${INVITES_URL}/inv1/revoke`);
    });
  });

  describe('canRevoke', () => {
    it('sin permiso, no muestra ningún botón de revocar', async () => {
      setup({ canRevoke: false });
      await flushInitial([makeMembership()]);

      expect(h.el.querySelector('[title="Revocar"]')).toBeNull();
    });

    it('revoca directo a un miembro que NO es el titular principal, sin pedir promoción', async () => {
      setup({ canRevoke: true });
      await flushInitial([
        makeMembership({ id: 'm1', isPrimaryContact: true }),
        makeMembership({ id: 'm2', roleType: 'Inquilino', isPrimaryContact: false, userId: 'u2', user: { id: 'u2', fullName: 'Luis Inquilino' } as any }),
      ]);

      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const rows = h.el.querySelectorAll('.member-row');
      const revokeBtn = rows[1].querySelector('[title="Revocar"]') as HTMLElement;
      revokeBtn.click();

      const req = h.http.expectOne(`${API}/properties/p1/memberships/m2`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ promoteMembershipId: undefined });
      req.flush(makeMembership({ id: 'm2', status: 'revoked' }));
      await settle();

      h.http.expectOne(`${API}/properties/p1/memberships`).flush([]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('revocada');
    });

    it('sin confirmación, no manda ninguna petición de revocación', async () => {
      setup({ canRevoke: true }, MANAGER);
      await flushInitial([makeMembership({ id: 'm2', isPrimaryContact: false })]);

      vi.spyOn(window, 'confirm').mockReturnValue(false);
      (h.el.querySelector('[title="Revocar"]') as HTMLElement).click();

      h.http.expectNone((r) => r.method === 'PATCH');
    });

    it('revocar al titular principal abre el selector de a quién promover', async () => {
      setup({ canRevoke: true });
      await flushInitial([
        makeMembership({ id: 'm1', isPrimaryContact: true, user: { id: 'u1', fullName: 'Ana García' } as any }),
        makeMembership({ id: 'm2', roleType: 'Inquilino', isPrimaryContact: false, userId: 'u2', user: { id: 'u2', fullName: 'Luis Inquilino' } as any }),
      ]);

      const rows = h.el.querySelectorAll('.member-row');
      (rows[0].querySelector('[title="Revocar"]') as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('titular principal');

      buttonWithText('Promover y revocar')!.click();

      const req = h.http.expectOne(`${API}/properties/p1/memberships/m1`);
      expect(req.request.body).toEqual({ promoteMembershipId: 'm2' });
      req.flush(makeMembership({ id: 'm1', status: 'revoked' }));
      await settle();

      h.http.expectOne(`${API}/properties/p1/memberships`).flush([]);
      await settle();
    });

    it('si no hay a quién promover, el botón de confirmar queda deshabilitado', async () => {
      setup({ canRevoke: true });
      await flushInitial([makeMembership({ id: 'm1', isPrimaryContact: true })]);

      (h.el.querySelector('[title="Revocar"]') as HTMLElement).click();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('No hay otro miembro vinculado');
      expect(buttonWithText('Promover y revocar')!.disabled).toBe(true);
    });
  });
});
