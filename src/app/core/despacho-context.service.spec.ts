import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AuthService, type AuthenticatedUser } from './auth.service';
import { DESPACHO_CONTEXT_KEY, DespachoContextService } from './despacho-context.service';
import { makeUser } from './testing/data-service-harness';

const roleA = makeUser({ id: 'a1', role: 'A', estateIds: [], administratorId: null });
const roleB = makeUser({ id: 'b1', role: 'B', administratorId: 'admin1' });

function setup(user: AuthenticatedUser | null) {
  const currentUser = signal<AuthenticatedUser | null>(user);
  TestBed.configureTestingModule({
    providers: [{ provide: AuthService, useValue: { currentUser } }],
  });
  return { service: TestBed.inject(DespachoContextService), currentUser };
}

describe('DespachoContextService', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('role A selects a despacho and it is kept for the browser tab', () => {
    const { service } = setup(roleA);
    service.select({ id: 'd1', name: 'Fincas García' });
    expect(service.selected()).toEqual({ id: 'd1', name: 'Fincas García' });

    TestBed.resetTestingModule();
    const restored = setup(roleA).service;
    expect(restored.selected()).toEqual({ id: 'd1', name: 'Fincas García' });
  });

  it('clear() drops the selection and its stored copy', () => {
    const { service } = setup(roleA);
    service.select({ id: 'd1', name: 'Fincas García' });
    service.clear();
    expect(service.selected()).toBeNull();
    expect(sessionStorage.getItem(DESPACHO_CONTEXT_KEY)).toBeNull();
  });

  it('logout clears the selection', () => {
    const { service, currentUser } = setup(roleA);
    service.select({ id: 'd1', name: 'Fincas García' });
    TestBed.tick();
    currentUser.set(null);
    TestBed.tick();
    expect(service.selected()).toBeNull();
    expect(sessionStorage.getItem(DESPACHO_CONTEXT_KEY)).toBeNull();

    currentUser.set(roleA);
    TestBed.tick();
    expect(service.selected()).toBeNull();
  });

  it('a selection stored by another user is never applied', () => {
    sessionStorage.setItem(DESPACHO_CONTEXT_KEY, JSON.stringify({ userId: 'other', id: 'd1', name: 'X' }));
    const { service } = setup(roleA);
    expect(service.selected()).toBeNull();
  });

  it('role B ignores the context: select is a no-op and nothing is exposed', () => {
    sessionStorage.setItem(DESPACHO_CONTEXT_KEY, JSON.stringify({ userId: 'b1', id: 'd1', name: 'X' }));
    const { service } = setup(roleB);
    expect(service.selected()).toBeNull();
    service.select({ id: 'd2', name: 'Y' });
    expect(service.selected()).toBeNull();
  });

  it('works without sessionStorage (blocked storage)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    const { service } = setup(roleA);
    expect(service.selected()).toBeNull();
    service.select({ id: 'd1', name: 'Fincas García' });
    expect(service.selected()).toEqual({ id: 'd1', name: 'Fincas García' });
    expect(() => service.clear()).not.toThrow();
  });
});
