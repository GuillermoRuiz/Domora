import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService, type AuthenticatedUser } from './auth.service';
import { DespachoContextService } from './despacho-context.service';
import { SUPPORT_MESSAGES, SupportSessionService } from './support-session.service';
import type { SupportSession } from './models';
import { API, makeUser } from './testing/data-service-harness';

const roleA = makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null });
const roleB = makeUser({ id: 'b1', role: 'B', administratorId: 'admin1' });

function makeSession(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 's1', staffUserId: 'a1', administratorId: 'd1', reason: 'Revisar remesa', ticketRef: null,
    startedAt: new Date(Date.now()).toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    endedAt: null,
    ...overrides,
  };
}

function setup(user: AuthenticatedUser | null) {
  const currentUser = signal<AuthenticatedUser | null>(user);
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), { provide: AuthService, useValue: { currentUser } }],
  });
  return {
    service: TestBed.inject(SupportSessionService),
    despacho: TestBed.inject(DespachoContextService),
    http: TestBed.inject(HttpTestingController),
    currentUser,
  };
}

/** Selects a despacho and answers the restore request the selection triggers. */
async function selectDespacho(h: ReturnType<typeof setup>, id = 'd1', active: SupportSession[] = []): Promise<void> {
  h.despacho.select({ id, name: 'Fincas García' });
  TestBed.tick();
  h.http.expectOne(`${API}/support-sessions/active`).flush(active);
  await Promise.resolve();
  await new Promise((r) => setTimeout(r));
}

describe('SupportSessionService', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('start posts the despacho, the trimmed reason and the ticket, and keeps the session active', async () => {
    const h = setup(roleA);
    await selectDespacho(h);
    const promise = h.service.start({ reason: '  Revisar remesa  ', ticketRef: ' T-12 ' });
    const req = h.http.expectOne(`${API}/support-sessions`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ administratorId: 'd1', reason: 'Revisar remesa', ticketRef: 'T-12' });
    req.flush(makeSession({ ticketRef: 'T-12' }));
    await promise;
    expect(h.service.active()?.id).toBe('s1');
    h.http.verify();
  });

  it('an empty ticket is not sent', async () => {
    const h = setup(roleA);
    await selectDespacho(h);
    void h.service.start({ reason: 'Revisar remesa', ticketRef: '   ' });
    expect(h.http.expectOne(`${API}/support-sessions`).request.body).toEqual({ administratorId: 'd1', reason: 'Revisar remesa' });
  });

  it('end closes the session on the API and drops it', async () => {
    const h = setup(roleA);
    await selectDespacho(h, 'd1', [makeSession()]);
    expect(h.service.active()?.id).toBe('s1');
    const promise = h.service.end();
    const req = h.http.expectOne(`${API}/support-sessions/s1/end`);
    expect(req.request.method).toBe('POST');
    req.flush(makeSession({ endedAt: new Date().toISOString() }));
    await promise;
    expect(h.service.active()).toBeNull();
  });

  it('restores the active session of the selected despacho and ignores sessions of other despachos', async () => {
    const h = setup(roleA);
    await selectDespacho(h, 'd1', [makeSession({ id: 's-other', administratorId: 'd9' }), makeSession({ id: 's1' })]);
    expect(h.service.active()?.id).toBe('s1');

    await selectDespacho(h, 'd2', [makeSession({ id: 's1' })]);
    expect(h.service.active()).toBeNull();
  });

  it('drops the session when it expires', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-26T10:00:00Z'));
    const h = setup(roleA);
    h.despacho.select({ id: 'd1', name: 'Fincas García' });
    TestBed.tick();
    h.http.expectOne(`${API}/support-sessions/active`).flush([
      makeSession({ expiresAt: '2026-10-26T12:00:00.000Z' }),
    ]);
    await Promise.resolve(); await Promise.resolve();
    expect(h.service.active()?.id).toBe('s1');

    vi.advanceTimersByTime(2 * 60 * 60 * 1000 - 1000);
    expect(h.service.active()?.id).toBe('s1');
    vi.advanceTimersByTime(1000);
    expect(h.service.active()).toBeNull();
  });

  it('an already expired session is never restored', async () => {
    const h = setup(roleA);
    await selectDespacho(h, 'd1', [makeSession({ expiresAt: new Date(Date.now() - 1000).toISOString() })]);
    expect(h.service.active()).toBeNull();
  });

  it('logout drops the session', async () => {
    const h = setup(roleA);
    await selectDespacho(h, 'd1', [makeSession()]);
    h.currentUser.set(null);
    TestBed.tick();
    expect(h.service.active()).toBeNull();
  });

  describe('leaving the despacho ends the session on the server (T15)', () => {
    it('selecting another despacho ends the open session, then restores for the new one', async () => {
      const h = setup(roleA);
      await selectDespacho(h, 'd1', [makeSession()]);
      h.despacho.select({ id: 'd2', name: 'Urbanizaciones Norte' });
      TestBed.tick();
      const end = h.http.expectOne(`${API}/support-sessions/s1/end`);
      expect(end.request.method).toBe('POST');
      end.flush(makeSession({ endedAt: new Date().toISOString() }));
      h.http.expectOne(`${API}/support-sessions/active`).flush([]);
      await new Promise((r) => setTimeout(r));
      expect(h.service.active()).toBeNull();
      h.http.verify();
    });

    it('clearing the context («Salir» or any clear) ends the open session', async () => {
      const h = setup(roleA);
      await selectDespacho(h, 'd1', [makeSession()]);
      h.despacho.clear();
      TestBed.tick();
      h.http.expectOne(`${API}/support-sessions/s1/end`).flush(makeSession({ endedAt: new Date().toISOString() }));
      h.http.expectNone(`${API}/support-sessions/active`);
      expect(h.service.active()).toBeNull();
    });

    it('a failed end call does not throw and the session is dropped locally anyway', async () => {
      const h = setup(roleA);
      await selectDespacho(h, 'd1', [makeSession()]);
      h.despacho.clear();
      TestBed.tick();
      h.http.expectOne(`${API}/support-sessions/s1/end`).error(new ProgressEvent('error'));
      await new Promise((r) => setTimeout(r));
      expect(h.service.active()).toBeNull();
      expect(h.service.denial()).toBeNull();
    });

    it('logout cannot end it: the token is already gone, so no call is sent (it expires server-side)', async () => {
      const h = setup(roleA);
      await selectDespacho(h, 'd1', [makeSession()]);
      h.currentUser.set(null);
      TestBed.tick();
      h.http.expectNone(`${API}/support-sessions/s1/end`);
      expect(h.service.active()).toBeNull();
    });

    it('a page reload restores the session and never ends it', async () => {
      const h = setup(roleA);
      await selectDespacho(h, 'd1', [makeSession()]);
      TestBed.resetTestingModule();
      const reloaded = setup(roleA);
      TestBed.tick();
      reloaded.http.expectOne(`${API}/support-sessions/active`).flush([makeSession()]);
      await new Promise((r) => setTimeout(r));
      reloaded.http.expectNone(`${API}/support-sessions/s1/end`);
      expect(reloaded.service.active()?.id).toBe('s1');
    });

    it('a session already ended with «Finalizar» is not ended twice when leaving', async () => {
      const h = setup(roleA);
      await selectDespacho(h, 'd1', [makeSession()]);
      const ending = h.service.end();
      h.http.expectOne(`${API}/support-sessions/s1/end`).flush(makeSession({ endedAt: new Date().toISOString() }));
      await ending;
      h.despacho.clear();
      TestBed.tick();
      h.http.expectNone(`${API}/support-sessions/s1/end`);
    });
  });

  it('role B never asks for support sessions and has none', () => {
    sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: 'b1', id: 'd1', name: 'X' }));
    const h = setup(roleB);
    TestBed.tick();
    h.http.expectNone(`${API}/support-sessions/active`);
    expect(h.service.active()).toBeNull();
  });

  describe('support denials (403)', () => {
    it('noSession is surfaced to the user', async () => {
      const h = setup(roleA);
      await selectDespacho(h);
      expect(h.service.handleForbidden(SUPPORT_MESSAGES.noSession)).toBe(true);
      expect(h.service.denial()).toBe(SUPPORT_MESSAGES.noSession);
      h.service.dismissDenial();
      expect(h.service.denial()).toBeNull();
    });

    it('invalidSession drops the session and is surfaced', async () => {
      const h = setup(roleA);
      await selectDespacho(h, 'd1', [makeSession()]);
      expect(h.service.handleForbidden(SUPPORT_MESSAGES.invalidSession)).toBe(true);
      expect(h.service.active()).toBeNull();
      expect(h.service.denial()).toBe(SUPPORT_MESSAGES.invalidSession);
    });

    it('otherDespacho is surfaced', async () => {
      const h = setup(roleA);
      await selectDespacho(h);
      expect(h.service.handleForbidden(SUPPORT_MESSAGES.otherDespacho)).toBe(true);
      expect(h.service.denial()).toBe(SUPPORT_MESSAGES.otherDespacho);
    });

    it('any other 403 is not a support denial', async () => {
      const h = setup(roleA);
      await selectDespacho(h);
      expect(h.service.handleForbidden('Forbidden resource')).toBe(false);
      expect(h.service.denial()).toBeNull();
    });

    it('starting a session clears the denial', async () => {
      const h = setup(roleA);
      await selectDespacho(h);
      h.service.handleForbidden(SUPPORT_MESSAGES.noSession);
      const promise = h.service.start({ reason: 'Revisar remesa' });
      h.http.expectOne(`${API}/support-sessions`).flush(makeSession());
      await promise;
      expect(h.service.denial()).toBeNull();
    });
  });
  describe('ensureRestored (route guard)', () => {
    it('restores the session of the selected despacho and shares the request with the context effect', async () => {
      const h = setup(roleA);
      h.despacho.select({ id: 'd1', name: 'Fincas García' });
      const restored = h.service.ensureRestored();
      TestBed.tick();
      h.http.expectOne(`${API}/support-sessions/active`).flush([makeSession()]);
      await restored;
      expect(h.service.active()?.id).toBe('s1');
      h.http.verify();
    });

    it('resolves at once without a despacho, for other roles or with the session already active', async () => {
      const b = setup(roleB);
      await b.service.ensureRestored();
      b.http.verify();
    });
  });

  describe('lost', () => {
    it('is bumped when the session is ended, rejected by the API or expires, not when the despacho changes', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      const h = setup(roleA);
      h.despacho.select({ id: 'd1', name: 'Fincas García' });
      TestBed.tick();
      h.http.expectOne(`${API}/support-sessions/active`).flush([makeSession({ expiresAt: new Date(Date.now() + 1000).toISOString() })]);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.service.active()).not.toBeNull();
      const before = h.service.lost();

      await vi.advanceTimersByTimeAsync(1500);
      expect(h.service.active()).toBeNull();
      expect(h.service.lost()).toBe(before + 1);

      expect(h.service.handleForbidden(SUPPORT_MESSAGES.invalidSession)).toBe(true);
      expect(h.service.lost()).toBe(before + 1);
    });
  });
});
