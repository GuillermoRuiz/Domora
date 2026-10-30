import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import {
  setupComponent,
  makeUser,
  settle,
} from '../../core/testing/component-harness';
import { AuthService } from '../../core/auth.service';
import { StateService } from '../../core/state.service';
import { OfficeSetupService, type OfficeCompletenessDetail } from '../../core/office-setup.service';
import { AccountMenuComponent } from './account-menu.component';

describe('AccountMenuComponent', () => {
  function setup(role: 'A' | 'B' | 'C' = 'B') {
    const h = setupComponent(AccountMenuComponent, {
      user: makeUser({ role, fullName: 'Ana García' }),
    });
    h.fixture.detectChanges();
    document.body.append(h.el);
    return h;
  }

  it('abre un menú de acciones con identidad real y devuelve el foco con Escape', async () => {
    const { fixture, el } = setup();
    const trigger = el.querySelector('button')!;
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    fixture.detectChanges();
    await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('[role="menu"]')?.textContent).toContain(
      'Ana García',
    );
    expect(document.activeElement?.textContent).toContain('Mi perfil');
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('navega con flechas, Home y End, y cierra al hacer clic fuera', async () => {
    const { fixture, el } = setup();
    el.querySelector('button')!.click();
    fixture.detectChanges();
    await settle();
    const menu = el.querySelector('[role="menu"]')!;
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement?.textContent).toContain('Configuración');
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    );
    expect(document.activeElement?.textContent).toContain('Cerrar sesión');
    menu.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
    );
    expect(document.activeElement?.textContent).toContain('Mi perfil');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('button')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  for (const role of ['A', 'B', 'C'] as const) {
    it(`rol ${role}: perfil y configuración conservan la ruta de ajustes`, () => {
      const { fixture, el } = setup(role);
      const navigate = vi
        .spyOn(TestBed.inject(Router), 'navigate')
        .mockResolvedValue(true);
      for (const selector of [
        '.account-menu__profile',
        '.account-menu__settings',
      ]) {
        el.querySelector('button')!.click();
        fixture.detectChanges();
        (el.querySelector(selector) as HTMLButtonElement).click();
        expect(navigate).toHaveBeenLastCalledWith([
          `/${role.toLowerCase()}/settings`,
        ]);
      }
    });
  }

  it('reutiliza el tema y su persistencia', () => {
    const { fixture, el } = setup();
    const state = TestBed.inject(StateService);
    state.darkMode.set(true);
    fixture.detectChanges();
    el.querySelector('button')!.click();
    fixture.detectChanges();
    (el.querySelector('.account-menu__theme') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(state.darkMode()).toBe(false);
    expect(localStorage.getItem('domora-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('logout llama al flujo de AuthService y redirige a login', async () => {
    const { fixture, el } = setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    Object.assign(TestBed.inject(AuthService), { logout });
    const navigate = vi
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    el.querySelector('button')!.click();
    fixture.detectChanges();
    (el.querySelector('.account-menu__logout') as HTMLButtonElement).click();
    await settle();
    expect(logout).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/login']);
  });

  it('desactiva la ruta protegida antes de limpiar la sesión', async () => {
    const { fixture } = setup();
    let navigated!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      navigated = resolve;
    });
    const revoke = vi.fn().mockResolvedValue(undefined);
    Object.assign(TestBed.inject(AuthService), { logout: revoke });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockReturnValue(pending);
    const logout = fixture.componentInstance.logout();
    await settle();
    expect(revoke).not.toHaveBeenCalled();
    navigated(true);
    await logout;
    expect(revoke).toHaveBeenCalledOnce();
  });

  it('limpia la sesión aunque falle la navegación', async () => {
    const { fixture } = setup();
    const logout = vi.fn().mockResolvedValue(undefined);
    Object.assign(TestBed.inject(AuthService), { logout });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockRejectedValue(
      new Error('navigation failed'),
    );
    await expect(fixture.componentInstance.logout()).rejects.toThrow(
      'navigation failed',
    );
    expect(logout).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.loggingOut()).toBe(false);
  });

  it('agrupa los enlaces legales en el submenú «Legal y privacidad» y lo cierra al seguir uno', async () => {
    for (const role of ['A', 'B', 'C'] as const) {
      TestBed.resetTestingModule();
      const { fixture, el } = setup(role);
      el.querySelector('button')!.click();
      fixture.detectChanges();
      await settle();
      expect(el.querySelector('.account-menu__legal-list')).toBeNull();
      const legal = el.querySelector<HTMLButtonElement>('.account-menu__legal')!;
      expect(legal.textContent).toContain('Legal y privacidad');
      legal.click();
      fixture.detectChanges();
      expect(legal.getAttribute('aria-expanded')).toBe('true');
      const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.account-menu__legal-link'));
      expect(links.map(link => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
        ['Privacidad', '/privacidad'],
        ['Aviso legal', '/aviso-legal'],
        ['Cookies', '/cookies'],
        ['Términos y condiciones', '/terminos'],
      ]);
      links[2].click();
      fixture.detectChanges();
      expect(el.querySelector('.account-menu__legal-list')).toBeNull();
      expect(el.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
      el.remove();
    }
  });
  describe('puesta en marcha del despacho pendiente', () => {
    const office = (pending: string[]): OfficeCompletenessDetail => ({
      administratorId: 'a1', name: 'Despacho', office: 0, estates: 0, total: 0, estateCount: 1, onboardingComplete: false, includedInAverage: true, estateDetails: [],
      officeSteps: (['contact', 'billing', 'payment', 'estates', 'team', 'twoFactor'] as const).map((key) => ({
        key, weight: key === 'team' ? ('info' as const) : key === 'contact' || key === 'twoFactor' ? ('recommended' as const) : ('required' as const), status: pending.includes(key) ? ('pending' as const) : ('done' as const),
      })),
    });

    it('con pasos obligatorios o recomendados pendientes marca el avatar y «Configuración» con un punto, sin contador', async () => {
      const { fixture, el } = setup('B');
      TestBed.inject(OfficeSetupService).own.set(office(['payment', 'twoFactor', 'team']));
      fixture.detectChanges();

      expect(el.querySelector('.account-menu__trigger .account-menu__dot')).not.toBeNull();
      expect(el.querySelector('.account-menu__trigger')?.getAttribute('aria-label')).toContain('puesta en marcha pendiente');
      expect(el.querySelector('.account-menu__settings .account-menu__dot')).not.toBeNull();
      expect(el.querySelector('.account-menu__dot')?.textContent?.trim()).toBe('');
    });

    it('si solo falta el paso opcional (equipo) no hay punto', async () => {
      const { fixture, el } = setup('B');
      TestBed.inject(OfficeSetupService).own.set(office(['team']));
      fixture.detectChanges();

      expect(el.querySelector('.account-menu__dot')).toBeNull();
    });

    it('un rol sin despacho propio no muestra punto aunque haya datos cargados', () => {
      const { fixture, el } = setup('C');
      TestBed.inject(OfficeSetupService).own.set(office(['payment']));
      fixture.detectChanges();

      expect(el.querySelector('.account-menu__dot')).toBeNull();
    });
  });
});
