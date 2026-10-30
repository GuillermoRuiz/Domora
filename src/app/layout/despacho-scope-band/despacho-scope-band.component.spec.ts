import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { API, makeUser, setupComponent, settle } from '../../core/testing/component-harness';
import { DespachoContextService } from '../../core/despacho-context.service';
import { SUPPORT_MESSAGES, SupportSessionService } from '../../core/support-session.service';
import type { SupportSession } from '../../core/models';
import { DespachoScopeBandComponent } from './despacho-scope-band.component';

const roleA = makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null });

function session(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 's1', staffUserId: 'a1', administratorId: 'd1', reason: 'Revisar remesa', ticketRef: null,
    startedAt: new Date().toISOString(), expiresAt: '2099-01-01T13:05:00.000Z', endedAt: null,
    ...overrides,
  };
}

async function mountWithDespacho(active: SupportSession[] = []) {
  sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'a1', id: 'd1', name: 'Fincas García' }));
  const h = setupComponent(DespachoScopeBandComponent, { user: roleA });
  h.fixture.detectChanges();
  TestBed.tick();
  h.http.expectOne(`${API}/support-sessions/active`).flush(active);
  await settle();
  h.fixture.detectChanges();
  return h;
}

const button = (el: HTMLElement, text: string) =>
  Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

describe('DespachoScopeBandComponent', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('is hidden for role B', () => {
    const { fixture, el } = setupComponent(DespachoScopeBandComponent, { user: makeUser({ role: 'B' }) });
    fixture.detectChanges();
    expect(el.querySelector('.scope-band')).toBeNull();
  });

  it('is hidden for role A without a selected despacho', () => {
    const { fixture, el } = setupComponent(DespachoScopeBandComponent, { user: roleA });
    fixture.detectChanges();
    expect(el.querySelector('.scope-band')).toBeNull();
  });

  it('shows «Viendo: <despacho>» and «Salir» clears the context and returns to /a/admins', async () => {
    const { fixture, el } = await mountWithDespacho();
    const band = el.querySelector('.scope-band');
    expect(band?.textContent).toContain('Viendo: Fincas García');
    expect(band?.classList.contains('scope-band--support')).toBe(false);

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    button(el, 'Salir')!.click();
    fixture.detectChanges();
    expect(TestBed.inject(DespachoContextService).selected()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/a/admins');
    expect(el.querySelector('.scope-band')).toBeNull();
  });

  it('with an active support session switches to the warning style with its expiry time and «Finalizar» ends it', async () => {
    const { fixture, el, http } = await mountWithDespacho([session()]);
    const band = el.querySelector('.scope-band')!;
    const hhmm = new Date('2099-01-01T13:05:00.000Z').toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    expect(band.classList.contains('scope-band--support')).toBe(true);
    expect(band.getAttribute('role')).toBe('status');
    expect(band.textContent).toContain('Modo soporte activo');
    expect(band.textContent).toContain('Fincas García');
    expect(band.textContent).toContain(`caduca a las ${hhmm}`);
    expect(button(el, 'Salir')).toBeUndefined();

    button(el, 'Finalizar')!.click();
    http.expectOne(`${API}/support-sessions/s1/end`).flush(session({ endedAt: new Date().toISOString() }));
    await settle();
    fixture.detectChanges();
    expect(el.querySelector('.scope-band--support')).toBeNull();
    expect(el.querySelector('.scope-band')?.textContent).toContain('Viendo: Fincas García');
  });

  it('«Modo soporte» opens the support dialog', async () => {
    const { fixture, el } = await mountWithDespacho();
    expect(el.querySelector('app-support-session-dialog')).toBeNull();
    button(el, 'Modo soporte')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-support-session-dialog')).not.toBeNull();
  });

  it('a support denial is shown with the option to start support mode', async () => {
    const { fixture, el } = await mountWithDespacho();
    TestBed.inject(SupportSessionService).handleForbidden(SUPPORT_MESSAGES.noSession);
    fixture.detectChanges();
    const alert = el.querySelector('.scope-band__denial');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain(SUPPORT_MESSAGES.noSession);

    button(el, 'Iniciar modo soporte')!.click();
    fixture.detectChanges();
    expect(el.querySelector('app-support-session-dialog')).not.toBeNull();
  });

  it('sticks below the fixed topbar and stays underneath it (never covers title, search or «Abrir menú»)', async () => {
    const { fixture } = await mountWithDespacho();
    const host = fixture.nativeElement as HTMLElement;
    const style = getComputedStyle(host);
    expect(style.position).toBe('sticky');
    // Offset by the measured header bottom (topbar + subscription banner), falling back to the token.
    expect(style.top.replace(/\s+/g, '')).toBe('var(--shell-header-bottom,var(--topbar-height))');
    // The topbar's fixed bar uses z-index 90: the band must paint below it.
    expect(Number(style.zIndex)).toBeLessThan(90);
  });

  it('when the session is no longer valid the offer is to restart support mode', async () => {
    const { fixture, el } = await mountWithDespacho([session()]);
    TestBed.inject(SupportSessionService).handleForbidden(SUPPORT_MESSAGES.invalidSession);
    fixture.detectChanges();
    expect(el.querySelector('.scope-band--support')).toBeNull();
    expect(el.querySelector('.scope-band__denial')?.textContent).toContain(SUPPORT_MESSAGES.invalidSession);
    expect(button(el, 'Reiniciar modo soporte')).toBeDefined();
  });
});
