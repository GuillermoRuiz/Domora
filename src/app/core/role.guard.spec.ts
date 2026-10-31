import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter, Router, UrlTree } from '@angular/router';
import type { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { roleGuard, supportReturnUrl } from './role.guard';
import { AuthService } from './auth.service';
import { DespachoContextService } from './despacho-context.service';
import { SupportSessionService } from './support-session.service';
import type { Role } from './models';

/**
 * Guard funcional — usa inject() internamente, así que necesita un contexto
 * de inyección real (TestBed.runInInjectionContext), pero no hace falta
 * montar ningún componente ni TestBed completo de renderizado.
 */
describe('roleGuard', () => {
  interface Setup {
    role?: Role | null;
    despachoId?: string | null;
    /** Sesión de soporte activa tras `ensureRestored()`. */
    sessionAfterRestore?: boolean;
  }

  let ensureRestored: ReturnType<typeof vi.fn>;

  function setup({ role = 'B', despachoId = null, sessionAfterRestore = false }: Setup = {}): void {
    const active = signal<object | null>(null);
    ensureRestored = vi.fn(async () => {
      if (sessionAfterRestore) active.set({ id: 's1' });
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { currentUser: () => (role ? { id: 'u1', role } : null) } },
        { provide: DespachoContextService, useValue: { selected: () => (despachoId ? { id: despachoId, name: 'Fincas Sol' } : null) } },
        { provide: SupportSessionService, useValue: { active, ensureRestored } },
      ],
    });
  }

  const noop = {} as ActivatedRouteSnapshot;

  async function run(url: string): Promise<string | true> {
    const result = await TestBed.runInInjectionContext(() => roleGuard(noop, { url } as RouterStateSnapshot));
    if (result === true) return true;
    return TestBed.inject(Router).serializeUrl(result as UrlTree);
  }

  it('sin sesión, redirige a /login', async () => {
    setup({ role: null });
    expect(await run('/b/estates')).toBe('/login');
  });

  it.each<[Role, string]>([
    ['A', '/a/overview'],
    ['B', '/b/estates/e1?tab=juntas'],
    ['C', '/c/community'],
  ])('el rol %s entra en su área (%s)', async (role, url) => {
    setup({ role });
    expect(await run(url)).toBe(true);
  });

  it('las rutas fuera de las áreas de rol no dependen del rol', async () => {
    setup({ role: 'C' });
    expect(await run('/')).toBe(true);
  });

  it.each<[Role, string, string]>([
    ['C', '/b/estates', '/c/community'],
    ['C', '/b/accounting/e1', '/c/community'],
    ['C', '/a/overview', '/c/community'],
    ['B', '/c/community', '/b/overview'],
    ['B', '/a/admins', '/b/overview'],
    ['A', '/c/community', '/a/overview'],
  ])('el rol %s no entra en %s: vuelve a %s', async (role, url, home) => {
    setup({ role });
    expect(await run(url)).toBe(home);
  });

  it('el rol A entra en las pantallas del rol B con una sesión de soporte del despacho', async () => {
    setup({ role: 'A', despachoId: 'd1', sessionAfterRestore: true });
    expect(await run('/b/estates/e1')).toBe(true);
    expect(ensureRestored).toHaveBeenCalled();
  });

  it('el rol A sin sesión de soporte vuelve a la ficha del despacho, que pide el modo soporte', async () => {
    setup({ role: 'A', despachoId: 'd1' });
    expect(await run('/b/estates/e1?tab=juntas')).toBe('/a/admins/d1?support=required&returnUrl=%2Fb%2Festates%2Fe1%3Ftab%3Djuntas');
  });

  it('el rol A sin despacho elegido vuelve a la lista de despachos', async () => {
    setup({ role: 'A' });
    expect(await run('/b/estates')).toBe('/a/admins');
  });

  it('supportReturnUrl solo acepta pantallas del rol B', () => {
    expect(supportReturnUrl('/b/estates/e1')).toBe('/b/estates/e1');
    expect(supportReturnUrl('/a/admins')).toBeNull();
    expect(supportReturnUrl('https://evil.example/b/')).toBeNull();
    expect(supportReturnUrl('//evil.example')).toBeNull();
    expect(supportReturnUrl(null)).toBeNull();
  });
});
