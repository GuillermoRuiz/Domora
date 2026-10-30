import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Route } from '@angular/router';
import { routes } from '../app.routes';
import { OwnerScopeService, type ScopeProperty } from './owner-scope.service';
import { ownerCommunitySectionRedirect } from './owner-section-redirect';

@Component({ standalone: true, template: '' })
class BlankComponent {}

const P1: ScopeProperty = { id: 'p1', nickname: '3A', addressFull: '', estateId: 'e1', estateName: 'Colón 24', isLinked: true };
const P2: ScopeProperty = { id: 'p2', nickname: '1A', addressFull: '', estateId: 'e2', estateName: 'Cuba 18', isLinked: true };

function setup(items: ScopeProperty[], opts: { loaded?: boolean; selected?: ScopeProperty | null } = {}) {
  const loaded = signal(opts.loaded ?? true);
  const scope = {
    items: signal(items),
    loaded,
    selected: () => opts.selected ?? null,
    load: vi.fn(async () => loaded.set(true)),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: OwnerScopeService, useValue: scope },
      provideRouter([
        { path: 'c/community', canActivate: [ownerCommunitySectionRedirect], component: BlankComponent },
        // Igual que en la app: el inicio antiguo redirige conservando la query.
        { path: 'c/properties', pathMatch: 'full', redirectTo: 'c/community' },
        { path: 'c/properties/:id', component: BlankComponent },
        { path: 'c/recibos', component: BlankComponent },
        { path: 'c/juntas', component: BlankComponent },
      ]),
    ],
  });
  return { router: TestBed.inject(Router), scope };
}

describe('ownerCommunitySectionRedirect', () => {
  it('?tab=communications&estateId= abre los comunicados de la propiedad del propietario en esa finca', async () => {
    const { router } = setup([P1, P2]);
    await router.navigateByUrl('/c/community?tab=communications&estateId=e2');
    expect(router.url).toBe('/c/properties/p2?tab=communications');
  });

  it('el enlace antiguo /c/properties?tab=communications llega a los comunicados de una propiedad', async () => {
    const { router } = setup([P1, P2], { selected: P2 });
    await router.navigateByUrl('/c/properties?tab=communications');
    expect(router.url).toBe('/c/properties/p2?tab=communications');
  });

  it('?tab=reservas con propertyId abre esa propiedad; sin nada, la primera', async () => {
    const { router } = setup([P1, P2]);
    await router.navigateByUrl('/c/community?tab=reservas&propertyId=p2');
    expect(router.url).toBe('/c/properties/p2?tab=reservas');
    await router.navigateByUrl('/c/community?tab=reservas');
    expect(router.url).toBe('/c/properties/p1?tab=reservas');
  });

  it('carga las propiedades si aún no se conocen', async () => {
    const { router, scope } = setup([P1], { loaded: false });
    await router.navigateByUrl('/c/community?tab=communications');
    expect(scope.load).toHaveBeenCalled();
    expect(router.url).toBe('/c/properties/p1?tab=communications');
  });

  it('sin propiedades se queda en Mi comunidad', async () => {
    const { router } = setup([]);
    await router.navigateByUrl('/c/community?tab=communications');
    expect(router.url).toBe('/c/community');
  });

  it('recibos y juntas van a su módulo', async () => {
    const { router } = setup([P1]);
    await router.navigateByUrl('/c/properties?tab=receipts');
    expect(router.url).toBe('/c/recibos');
    await router.navigateByUrl('/c/community?tab=juntas&estateId=e1');
    expect(router.url).toBe('/c/juntas?estateId=e1');
  });

  it('sin sección, «Mi comunidad» se abre como siempre', async () => {
    const { router, scope } = setup([P1]);
    await router.navigateByUrl('/c/community');
    expect(router.url).toBe('/c/community');
    expect(scope.load).not.toHaveBeenCalled();
  });

  it('la app lo aplica en /c/community', () => {
    const flat = (list: Route[]): Route[] => list.flatMap((r) => [r, ...flat(r.children ?? [])]);
    expect(flat(routes).find((r) => r.path === 'c/community')?.canActivate).toContain(ownerCommunitySectionRedirect);
  });
});
