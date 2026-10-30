import { Router, convertToParamMap, ActivatedRoute } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { LoginComponent } from './login.component';

import { DemoLoginPanel } from '../../demo/demo-ui.demo';

// Simula el fileReplacements del build `demo` (demo-ui.ts -> demo-ui.demo.ts).
// vi.mock no está soportado por el runner de Angular para imports relativos,
// así que se inyecta en la instancia lo que el reemplazo pondría en DemoLoginPanel.

const rawUser = { id: 'u1', fullName: 'Pepe Propietario', role: 'C', estateIds: ['e1'], administratorId: 'a1' };

describe('LoginComponent con demo-ui del build demo', () => {
  let h: ComponentHarness<LoginComponent>;
  let router: Router;

  beforeEach(async () => {
    h = setupComponent(LoginComponent, {
      realAuth: true,
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({}) } } },
      ],
    });
    h.component.demoPanel = DemoLoginPanel;
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  });

  afterEach(() => h.http.verify());

  it('renderiza el botón "Modo demo" y, al pulsarlo, el modal con las cuentas @demo.domora.app', () => {
    const btn = h.el.querySelector<HTMLButtonElement>('.demo-panel__btn');
    expect(btn?.textContent).toContain('Modo demo');
    expect(h.el.textContent).not.toContain('Elige un rol de prueba');

    btn!.click();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Elige un rol de prueba');
    const options = Array.from(h.el.querySelectorAll('.demo-panel__option'));
    expect(options).toHaveLength(5);
  });

  it('entra con la cuenta elegida y navega a la pantalla de su rol', async () => {
    h.el.querySelector<HTMLButtonElement>('.demo-panel__btn')!.click();
    h.fixture.detectChanges();

    const moroso = Array.from(h.el.querySelectorAll<HTMLButtonElement>('.demo-panel__option')).find((b) =>
      b.textContent?.includes('moroso'),
    )!;
    moroso.click();
    h.fixture.detectChanges();

    const req = h.http.expectOne(`${API}/auth/login`);
    expect(req.request.body.email).toBe('moroso@demo.domora.app');
    req.flush({ accessToken: 'tok', refreshToken: 'ref', user: rawUser });
    await settle();
    h.fixture.detectChanges();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/c/community');
    expect(h.el.textContent).not.toContain('Elige un rol de prueba');
  });

  it('si falla el login demo, deja el modal abierto con el error', async () => {
    h.el.querySelector<HTMLButtonElement>('.demo-panel__btn')!.click();
    h.fixture.detectChanges();
    h.el.querySelector<HTMLButtonElement>('.demo-panel__option')!.click();
    h.fixture.detectChanges();

    h.http.expectOne(`${API}/auth/login`).flush({ message: 'x' }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('No se pudo iniciar la sesión de demo.');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('cerrar el modal no dispara ningún login', () => {
    h.el.querySelector<HTMLButtonElement>('.demo-panel__btn')!.click();
    h.fixture.detectChanges();
    h.el.querySelector<HTMLButtonElement>('.demo-panel__close')!.click();
    h.fixture.detectChanges();

    expect(h.el.textContent).not.toContain('Elige un rol de prueba');
    h.http.expectNone(() => true);
  });
});
