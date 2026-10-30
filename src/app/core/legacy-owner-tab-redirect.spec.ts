import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { routes } from '../app.routes';
import { legacyCommunityIssueRedirect, legacyOwnerTabRedirect, ownerDocumentQueryParams, ownerIssueQueryParams } from './legacy-owner-tab-redirect';

@Component({ standalone: true, template: '' })
class BlankComponent {}

function setupRouter(): Router {
  TestBed.configureTestingModule({
    providers: [provideRouter([
      { path: 'c/properties/:id', canActivate: [legacyOwnerTabRedirect], component: BlankComponent },
      { path: 'c/incidencias', component: BlankComponent },
      { path: 'c/documentacion', component: BlankComponent },
    ])],
  });
  return TestBed.inject(Router);
}

describe('legacyOwnerTabRedirect', () => {
  it('?tab=issues de la ficha de propiedad lleva a la página de incidencias', async () => {
    const router = setupRouter();
    await router.navigateByUrl('/c/properties/p1?tab=issues');
    expect(router.url).toBe('/c/incidencias');
  });

  it('?tab=issues&action=new abre el alta en la página de incidencias', async () => {
    const router = setupRouter();
    await router.navigateByUrl('/c/properties/p1?tab=issues&action=new');
    expect(router.url).toBe('/c/incidencias?new=1');
  });

  it('?tab=issues&issue=<id> abre el detalle de esa incidencia', async () => {
    const router = setupRouter();
    await router.navigateByUrl('/c/properties/p1?tab=issues&issue=i9');
    expect(router.url).toBe('/c/incidencias?issue=i9');
  });

  it('?tab=documents de la ficha de propiedad lleva a la página de Documentación', async () => {
    const router = setupRouter();
    await router.navigateByUrl('/c/properties/p1?tab=documents');
    expect(router.url).toBe('/c/documentacion');
  });

  it('?tab=documents&doc=<id> abre ese documento en la página de Documentación', async () => {
    const router = setupRouter();
    await router.navigateByUrl('/c/properties/p1?tab=documents&doc=d7');
    expect(router.url).toBe('/c/documentacion?doc=d7');
  });

  it('las demás pestañas de la ficha siguen abriéndose como siempre', async () => {
    const router = setupRouter();
    await router.navigateByUrl('/c/properties/p1?tab=receipts');
    expect(router.url).toBe('/c/properties/p1?tab=receipts');
    await router.navigateByUrl('/c/properties/p1?tab=juntas');
    expect(router.url).toBe('/c/properties/p1?tab=juntas');
    await router.navigateByUrl('/c/properties/p1');
    expect(router.url).toBe('/c/properties/p1');
  });

  it('la app lo aplica en la ficha de propiedad y /c/requests lleva también a incidencias', () => {
    const flat = (list: Route[]): Route[] => list.flatMap((r) => [r, ...flat(r.children ?? [])]);
    const all = flat(routes);
    expect(all.find((r) => r.path === 'c/properties/:id')?.canActivate).toContain(legacyOwnerTabRedirect);
    expect(all.find((r) => r.path === 'c/requests')?.redirectTo).toBe('c/incidencias');
  });
});

describe('legacyCommunityIssueRedirect', () => {
  function setupCommunityRouter(): Router {
    TestBed.configureTestingModule({
      providers: [provideRouter([
        { path: 'c/community', canActivate: [legacyCommunityIssueRedirect], component: BlankComponent },
        { path: 'c/incidencias', component: BlankComponent },
      ])],
    });
    return TestBed.inject(Router);
  }

  it('?issue=<id> de «Mi comunidad» abre esa incidencia en Incidencias', async () => {
    const router = setupCommunityRouter();
    await router.navigateByUrl('/c/community?issue=i3');
    expect(router.url).toBe('/c/incidencias?issue=i3');
  });

  it('?tab=issues de «Mi comunidad» lleva a la página de incidencias', async () => {
    const router = setupCommunityRouter();
    await router.navigateByUrl('/c/community?tab=issues');
    expect(router.url).toBe('/c/incidencias');
  });

  it('«Mi comunidad» sin esos parámetros se abre como siempre', async () => {
    const router = setupCommunityRouter();
    await router.navigateByUrl('/c/community?tab=juntas');
    expect(router.url).toBe('/c/community?tab=juntas');
  });

  it('la app lo aplica en /c/community', () => {
    const flat = (list: Route[]): Route[] => list.flatMap((r) => [r, ...flat(r.children ?? [])]);
    expect(flat(routes).find((r) => r.path === 'c/community')?.canActivate).toContain(legacyCommunityIssueRedirect);
  });
});

describe('feed ids → query params', () => {
  it('issue:<id> abre esa incidencia; otros ids, la página sin selección', () => {
    expect(ownerIssueQueryParams('issue:i1')).toEqual({ issue: 'i1' });
    expect(ownerIssueQueryParams('issue:')).toEqual({});
    expect(ownerIssueQueryParams('receipt:r1')).toEqual({});
    expect(ownerIssueQueryParams(undefined)).toEqual({});
  });

  it('document:<id> abre ese documento; otros ids, la página sin selección', () => {
    expect(ownerDocumentQueryParams('document:d1')).toEqual({ doc: 'd1' });
    expect(ownerDocumentQueryParams('document:')).toEqual({});
    expect(ownerDocumentQueryParams('issue:i1')).toEqual({});
    expect(ownerDocumentQueryParams(null)).toEqual({});
  });
});
