import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Route, type UrlTree } from '@angular/router';
import { AuthService } from './auth.service';
import { routes } from '../app.routes';

describe('role-aware default redirects', () => {
  const appChildren = routes.find(route => route.path === '' && route.children)!.children!;

  const resolve = (route: Route, role: 'A' | 'B' | 'C' | null): string => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { currentUser: () => (role ? { role } : null) } }],
    });
    const redirect = route.redirectTo;
    if (typeof redirect === 'string') return redirect;
    const result = TestBed.runInInjectionContext(() => redirect!({} as never));
    return typeof result === 'string' ? result : TestBed.inject(Router).serializeUrl(result as UrlTree);
  };

  it.each([
    ['A', '/a/overview'],
    ['B', '/b/overview'],
    ['C', '/c/community'],
    [null, '/login'],
  ] as const)('sends role %s from the empty path to %s', (role, expected) => {
    expect(resolve(appChildren.find(route => route.path === '')!, role)).toBe(expected);
  });

  it.each([
    ['A', '/a/overview'],
    ['B', '/b/overview'],
    ['C', '/c/community'],
  ] as const)('sends role %s from an unknown URL to %s', (role, expected) => {
    expect(resolve(appChildren.find(route => route.path === '**')!, role)).toBe(expected);
  });

  it('declares every role A sidebar destination as a route', () => {
    const paths = appChildren.map(route => route.path);
    for (const path of ['a/overview', 'a/admins', 'a/clients', 'a/billing', 'a/analytics', 'a/onboarding',
      'a/support', 'a/communities', 'a/users', 'a/settings', 'a/audit']) {
      expect(paths).toContain(path);
    }
  });
});
