import { TestBed } from '@angular/core/testing';
import {
  Router,
  provideRouter,
  convertToParamMap,
  type ActivatedRouteSnapshot,
  type UrlTree,
} from '@angular/router';
import { AuthService } from '../../core/auth.service';
import {
  legacyEstateOperationsGuard,
  operationsRoleGuard,
} from './operations-routing';

describe('Operations routing', () => {
  function setup(role: 'A' | 'B' | 'C' | null = 'B') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { currentUser: () => (role ? { role } : null) },
        },
      ],
    });
    return TestBed.inject(Router);
  }
  function route(query: Record<string, string>) {
    return {
      paramMap: convertToParamMap({ id: 'e1' }),
      queryParamMap: convertToParamMap(query),
      queryParams: query,
    } as unknown as ActivatedRouteSnapshot;
  }
  it('preserves community and entity when opening a legacy issue link', () => {
    const router = setup();
    const result = TestBed.runInInjectionContext(() =>
      legacyEstateOperationsGuard(
        route({ tab: 'issues', entity: 'i1' }),
        {} as never,
      ),
    ) as UrlTree;
    expect(router.serializeUrl(result)).toBe('/b/incidencias/i1');
  });
  it('moves a legacy issues tab without an issue to the list of that community', () => {
    const router = setup();
    const result = TestBed.runInInjectionContext(() =>
      legacyEstateOperationsGuard(route({ tab: 'issues' }), {} as never),
    ) as UrlTree;
    expect(router.serializeUrl(result)).toBe('/b/incidencias?estateId=e1');
  });
  it('moves legacy meetings to the global page with the community filter', () => {
    const router = setup();
    const result = TestBed.runInInjectionContext(() =>
      legacyEstateOperationsGuard(route({ tab: 'juntas' }), {} as never),
    ) as UrlTree;
    expect(router.serializeUrl(result)).toBe('/b/juntas?estateId=e1');
  });
  it('leaves the remaining finca tabs unchanged', () => {
    setup();
    expect(
      TestBed.runInInjectionContext(() =>
        legacyEstateOperationsGuard(route({ tab: 'documents' }), {} as never),
      ),
    ).toBe(true);
  });
  for (const [role, destination] of [
    ['A', '/a/admins'],
    ['C', '/c/community'],
    [null, '/login'],
  ] as const) {
    it(`does not expose management pages to role ${role}`, () => {
      const router = setup(role);
      const result = TestBed.runInInjectionContext(() =>
        operationsRoleGuard({} as never, {} as never),
      ) as UrlTree;
      expect(router.serializeUrl(result)).toBe(destination);
    });
  }
  it('allows the administrator role', () => {
    setup('B');
    expect(
      TestBed.runInInjectionContext(() =>
        operationsRoleGuard({} as never, {} as never),
      ),
    ).toBe(true);
  });
});
