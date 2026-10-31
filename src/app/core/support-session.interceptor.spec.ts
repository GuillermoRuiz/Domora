import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { AuthService, type AuthenticatedUser } from './auth.service';
import { DespachoContextService } from './despacho-context.service';
import { SUPPORT_MESSAGES, SupportSessionService } from './support-session.service';
import { SUPPORT_SESSION_HEADER, supportSessionInterceptor } from './support-session.interceptor';
import type { SupportSession } from './models';
import { API, makeUser } from './testing/data-service-harness';

const roleA = makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null });

function session(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 's1', staffUserId: 'a1', administratorId: 'd1', reason: 'Revisar remesa', ticketRef: null,
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(), endedAt: null,
    ...overrides,
  };
}

function setup(user: AuthenticatedUser | null) {
  const currentUser = signal<AuthenticatedUser | null>(user);
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([supportSessionInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser } },
    ],
  });
  return {
    client: TestBed.inject(HttpClient),
    http: TestBed.inject(HttpTestingController),
    support: TestBed.inject(SupportSessionService),
    despacho: TestBed.inject(DespachoContextService),
  };
}

async function withActiveSession(h: ReturnType<typeof setup>): Promise<void> {
  h.despacho.select({ id: 'd1', name: 'Fincas García' });
  TestBed.tick();
  h.http.expectOne(`${API}/support-sessions/active`).flush([session()]);
  await new Promise((r) => setTimeout(r));
  expect(h.support.active()?.id).toBe('s1');
}

describe('supportSessionInterceptor', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it('adds the header to every API request while a session is active (reads need it too)', async () => {
    const h = setup(roleA);
    await withActiveSession(h);
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      void firstValueFrom(h.client.request(method, `${API}/estates/e1`, { body: {} }));
      const req = h.http.expectOne((r) => r.method === method && r.url === `${API}/estates/e1`);
      expect(req.request.headers.get(SUPPORT_SESSION_HEADER)).toBe('s1');
    }
  });

  it('never adds it to requests outside the API', async () => {
    const h = setup(roleA);
    await withActiveSession(h);
    void firstValueFrom(h.client.post('https://example.com/x', {}));
    expect(h.http.expectOne('https://example.com/x').request.headers.has(SUPPORT_SESSION_HEADER)).toBe(false);
  });

  it('without an active session, role A writes go without the header', () => {
    const h = setup(roleA);
    void firstValueFrom(h.client.post(`${API}/estates/e1/x`, {}));
    expect(h.http.expectOne(`${API}/estates/e1/x`).request.headers.has(SUPPORT_SESSION_HEADER)).toBe(false);
  });

  it('roles B and C never send it', () => {
    for (const user of [makeUser({ role: 'B' }), makeUser({ role: 'C', administratorId: null })]) {
      TestBed.resetTestingModule();
      sessionStorage.setItem('domora.despacho-context', JSON.stringify({ userId: user.id, id: 'd1', name: 'X' }));
      const h = setup(user);
      TestBed.tick();
      h.http.expectNone(`${API}/support-sessions/active`);
      void firstValueFrom(h.client.post(`${API}/estates/e1/x`, {}));
      expect(h.http.expectOne(`${API}/estates/e1/x`).request.headers.has(SUPPORT_SESSION_HEADER)).toBe(false);
    }
  });

  it('a 403 with a support message is surfaced and the error still reaches the caller', async () => {
    const h = setup(roleA);
    await withActiveSession(h);
    const promise = firstValueFrom(h.client.post(`${API}/estates/e1`, {}));
    h.http.expectOne(`${API}/estates/e1`).flush(
      { statusCode: 403, message: SUPPORT_MESSAGES.invalidSession, error: 'Forbidden' },
      { status: 403, statusText: 'Forbidden' },
    );
    await expect(promise).rejects.toMatchObject({ status: 403 });
    expect(h.support.denial()).toBe(SUPPORT_MESSAGES.invalidSession);
    expect(h.support.active()).toBeNull();
  });

  it('other 403s are left alone', async () => {
    const h = setup(roleA);
    await withActiveSession(h);
    const promise = firstValueFrom(h.client.post(`${API}/estates/e1`, {}));
    h.http.expectOne(`${API}/estates/e1`).flush({ statusCode: 403, message: 'Forbidden resource' }, { status: 403, statusText: 'Forbidden' });
    await expect(promise).rejects.toMatchObject({ status: 403 });
    expect(h.support.denial()).toBeNull();
    expect(h.support.active()?.id).toBe('s1');
  });
});
