import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { reportsRoleGuard } from './reports.guard';
import { routes } from '../../app.routes';

describe('reportsRoleGuard', () => {
  it('aplica el guard B a las tres rutas lazy de Informes', () => {
    const reportRoutes = routes.find(route => route.path === '')!.children!.filter(route => route.path?.startsWith('b/reports'));
    expect(reportRoutes.map(route => route.path)).toEqual(['b/reports', 'b/reports/category/:categoryKey', 'b/reports/view/:reportKey']);
    for (const route of reportRoutes) { expect(route.loadComponent).toBeTypeOf('function'); expect(route.canActivate).toContain(reportsRoleGuard); }
  });
  it.each(['A', 'B', 'C', null])('comprueba el rol de sesión %s', role => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: { currentUser: () => role ? { role } : null } }] });
    const result = TestBed.runInInjectionContext(() => reportsRoleGuard({} as never, {} as never));
    if (role === 'B') expect(result).toBe(true);
    else expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe(role === 'A' ? '/a/admins' : role === 'C' ? '/c/community' : '/login');
  });
});
