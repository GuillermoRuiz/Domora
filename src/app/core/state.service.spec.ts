import { TestBed } from '@angular/core/testing';
import { StateService } from './state.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { makeUser } from './testing/data-service-harness';

const THEME_KEY = 'domora-theme';

function setup(user: ReturnType<typeof makeUser> | null = makeUser({ role: 'B' })) {
  TestBed.configureTestingModule({
    providers: [{ provide: AuthService, useValue: { currentUser: () => user } }],
  });
  const state = TestBed.inject(StateService);
  // El effect() del constructor programa su primera pasada de forma
  // asíncrona (sin zone.js no hay autorun síncrono) — hay que vaciarla
  // antes de mirar document/localStorage.
  TestBed.tick();
  return state;
}

describe('StateService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  describe('currentRole', () => {
    it('usa el rol del usuario autenticado por defecto', () => {
      const state = setup(makeUser({ role: 'C' }));
      expect(state.currentRole()).toBe('C');
    });

    it('sin usuario en sesión, cae a "B"', () => {
      const state = setup(null);
      expect(state.currentRole()).toBe('B');
    });
  });

  describe('cycleRole', () => {
    it('con mockRoleSwitch activo, cicla A → B → C → A y prevalece sobre el rol real', () => {
      const original = environment.mockRoleSwitch;
      environment.mockRoleSwitch = true;
      try {
        const state = setup(makeUser({ role: 'B' }));
        expect(state.currentRole()).toBe('B');

        state.cycleRole();
        expect(state.currentRole()).toBe('C');

        state.cycleRole();
        expect(state.currentRole()).toBe('A');

        state.cycleRole();
        expect(state.currentRole()).toBe('B');
      } finally {
        environment.mockRoleSwitch = original;
      }
    });

    it('con mockRoleSwitch desactivado (producción), es un no-op', () => {
      const original = environment.mockRoleSwitch;
      environment.mockRoleSwitch = false;
      try {
        const state = setup(makeUser({ role: 'B' }));
        state.cycleRole();
        expect(state.currentRole()).toBe('B');
      } finally {
        environment.mockRoleSwitch = original;
      }
    });
  });

  describe('notificaciones', () => {
    it('bumpNotifications incrementa notificationsVersion en cada llamada', () => {
      const state = setup();
      expect(state.notificationsVersion()).toBe(0);
      state.bumpNotifications();
      state.bumpNotifications();
      expect(state.notificationsVersion()).toBe(2);
    });
  });

  describe('darkMode', () => {
    it('sin nada en localStorage, el oscuro es el tema por defecto', () => {
      const state = setup();
      expect(state.darkMode()).toBe(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    });

    it('con "light" ya guardado, arranca en claro', () => {
      localStorage.setItem(THEME_KEY, 'light');
      const state = setup();
      expect(state.darkMode()).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('toggleDarkMode invierte el signal y el effect persiste el cambio', () => {
      const state = setup();
      expect(state.darkMode()).toBe(true);

      state.toggleDarkMode();
      TestBed.tick();

      expect(state.darkMode()).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(localStorage.getItem(THEME_KEY)).toBe('light');
    });
  });

  describe('sidebarOpen (drawer móvil, ID 27 fase 1)', () => {
    it('arranca cerrado', () => {
      const state = setup();
      expect(state.sidebarOpen()).toBe(false);
    });

    it('toggleSidebar invierte el signal en cada llamada', () => {
      const state = setup();
      state.toggleSidebar();
      expect(state.sidebarOpen()).toBe(true);
      state.toggleSidebar();
      expect(state.sidebarOpen()).toBe(false);
    });

    it('closeSidebar siempre deja el signal en false, incluso ya cerrado', () => {
      const state = setup();
      state.closeSidebar();
      expect(state.sidebarOpen()).toBe(false);

      state.toggleSidebar();
      state.closeSidebar();
      expect(state.sidebarOpen()).toBe(false);
    });
  });
});
