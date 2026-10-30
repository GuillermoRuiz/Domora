import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { CommunityScopeService } from './community-scope.service';
import { AuthService } from './auth.service';
import type { AuthenticatedUser } from './auth.service';
import { DespachoContextService } from './despacho-context.service';

const user = (id: string, estateIds: string[]): AuthenticatedUser => ({ id, fullName: id, role: 'B', estateIds, administratorId: 'admin' });

describe('CommunityScopeService', () => {
  const current = signal<AuthenticatedUser | null>(null);
  function setup(): CommunityScopeService {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', children: [] }]), { provide: AuthService, useValue: { currentUser: current } }],
    });
    return TestBed.inject(CommunityScopeService);
  }
  beforeEach(() => { sessionStorage.clear(); current.set(user('b1', ['e1', 'e2'])); });

  it('recuerda la comunidad elegida y «Todas» la limpia', () => {
    const scope = setup();
    expect(scope.estateId()).toBeNull();
    scope.select('e1'); expect(scope.estateId()).toBe('e1');
    scope.select(null); expect(scope.estateId()).toBeNull();
  });

  it('expone la comunidad elegida con su nombre y sin pisar las conocidas al darle un nombre', () => {
    const scope = setup();
    expect(scope.selected()).toBeNull();
    scope.remember([{ id: 'e1', name: 'Los Pinos' }]);
    scope.select('e1'); expect(scope.selected()).toEqual({ id: 'e1', name: 'Los Pinos' });
    scope.select('e2', 'El Roble');
    expect(scope.selected()).toEqual({ id: 'e2', name: 'El Roble' });
    expect(scope.cachedEstates().map(estate => estate.id)).toEqual(['e1', 'e2']);
    scope.select(null); expect(scope.selected()).toBeNull();
  });

  it('no admite comunidades sin acceso ni las comparte con otro usuario', () => {
    const scope = setup();
    scope.select('otra'); expect(scope.estateId()).toBeNull();
    scope.select('e2'); expect(scope.estateId()).toBe('e2');
    current.set(user('b2', ['e1', 'e2']));
    expect(scope.estateId()).toBeNull();
  });

  it('sobrevive a recargar la página (sessionStorage) dentro de la misma sesión', () => {
    setup().select('e1');
    TestBed.resetTestingModule();
    expect(setup().estateId()).toBe('e1');
  });

  it('entrar en la ficha de una comunidad la fija como compartida', async () => {
    const scope = setup();
    await TestBed.inject(Router).navigateByUrl('/b/accounting/e2?tab=summary');
    expect(scope.estateId()).toBe('e2');
    await TestBed.inject(Router).navigateByUrl('/b/estates/e1');
    expect(scope.estateId()).toBe('e1');
    await TestBed.inject(Router).navigateByUrl('/b/estates');
    expect(scope.estateId()).toBe('e1');
  });

  it('una URL con un id que no es una comunidad accesible no borra la elegida', async () => {
    const scope = setup();
    scope.select('e1');
    await TestBed.inject(Router).navigateByUrl('/b/estates/otra-finca');
    expect(scope.estateId()).toBe('e1');
  });
  it('role A: a community chosen in one despacho is not carried over to another despacho', () => {
    current.set({ id: 'a1', fullName: 'Domora', role: 'A', estateIds: [], administratorId: null });
    const scope = setup();
    const despacho = TestBed.inject(DespachoContextService);
    despacho.select({ id: 'd1', name: 'Fincas García' });
    scope.remember([{ id: 'e1', name: 'Los Pinos' }]);
    scope.select('e1');
    expect(scope.estateId()).toBe('e1');
    expect(scope.cachedEstates()).toEqual([{ id: 'e1', name: 'Los Pinos' }]);

    despacho.select({ id: 'd2', name: 'Urbanizaciones Norte' });
    expect(scope.estateId()).toBeNull();
    expect(scope.cachedEstates()).toEqual([]);

    despacho.select({ id: 'd1', name: 'Fincas García' });
    expect(scope.estateId()).toBe('e1');
  });
});
