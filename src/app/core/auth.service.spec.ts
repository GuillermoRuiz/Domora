import { from, of, throwError } from 'rxjs';
import type { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

const API = environment.apiBaseUrl;

/**
 * AuthService usa inyección por constructor (a diferencia de DataService,
 * que inyecta por campo con `inject()`), así que se puede instanciar
 * directamente con un HttpClient falso — sin TestBed, mismo patrón que
 * los tests de integración del backend de esta sesión.
 */
function makeHttp(overrides: Partial<Record<'get' | 'post', ReturnType<typeof vi.fn>>> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

const REFRESH_TOKEN_KEY = 'domora-refresh-token';

describe('AuthService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('login', () => {
    it('guarda el access token en memoria, el refresh token en localStorage y normaliza subscriptionStatus', async () => {
      const http = makeHttp({
        post: vi.fn().mockReturnValue(of({
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          user: {
            id: 'u1', fullName: 'Ana Gestora', role: 'B',
            estateIds: ['e1'], administratorId: 'a1',
            subscriptionStatus: 'Periodo_de_gracia',
          },
        })),
      });
      const auth = new AuthService(http);

      await auth.login('ana@demo.app', 'secret');

      expect(auth.accessToken()).toBe('access-1');
      expect(auth.isAuthenticated()).toBe(true);
      expect(auth.currentUser()?.subscriptionStatus).toBe('Periodo de gracia');
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-1');
      expect(http.post).toHaveBeenCalledWith(
        `${API}/auth/login`,
        { email: 'ana@demo.app', password: 'secret' },
      );
    });

    it('deja subscriptionStatus undefined para rol C (sin gestora)', async () => {
      const http = makeHttp({
        post: vi.fn().mockReturnValue(of({
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          user: { id: 'u2', fullName: 'Pepe Propietario', role: 'C', estateIds: [], administratorId: null },
        })),
      });
      const auth = new AuthService(http);

      await auth.login('pepe@demo.app', 'secret');

      expect(auth.currentUser()?.subscriptionStatus).toBeUndefined();
    });

    it('propaga el error si las credenciales son inválidas, sin dejar sesión a medias', async () => {
      const http = makeHttp({ post: vi.fn().mockReturnValue(throwError(() => new Error('401'))) });
      const auth = new AuthService(http);

      await expect(auth.login('ana@demo.app', 'mal')).rejects.toThrow('401');
      expect(auth.isAuthenticated()).toBe(false);
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    });
  });

  describe('restoreSession', () => {
    it('sin refresh token persistido, no intenta nada y queda sin sesión', async () => {
      const http = makeHttp();
      const auth = new AuthService(http);

      await auth.restoreSession();

      expect(auth.isAuthenticated()).toBe(false);
      expect(http.post).not.toHaveBeenCalled();
      expect(http.get).not.toHaveBeenCalled();
    });

    it('con refresh token válido, refresca y recupera /auth/me normalizando el estado', async () => {
      localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-refresh');
      const http = makeHttp({
        post: vi.fn().mockReturnValue(of({ accessToken: 'access-2', refreshToken: 'refresh-2' })),
        get: vi.fn().mockReturnValue(of({
          id: 'u1', fullName: 'Ana Gestora', role: 'B', estateIds: ['e1'], administratorId: 'a1',
          subscriptionStatus: 'Vencida',
        })),
      });
      const auth = new AuthService(http);

      await auth.restoreSession();

      expect(auth.accessToken()).toBe('access-2');
      expect(auth.currentUser()?.subscriptionStatus).toBe('Vencida');
      // El refresh token rota — se persiste el nuevo, no el que había.
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-2');
    });

    it('si el refresh token ya no es válido, limpia toda la sesión local', async () => {
      localStorage.setItem(REFRESH_TOKEN_KEY, 'stale-refresh');
      const http = makeHttp({ post: vi.fn().mockReturnValue(throwError(() => new Error('401'))) });
      const auth = new AuthService(http);

      await auth.restoreSession();

      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.accessToken()).toBeNull();
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    });
  });

  describe('refresh — de-duplicación de llamadas concurrentes', () => {
    it('varias llamadas simultáneas comparten la misma petición en curso (el refresh token es de un solo uso)', async () => {
      localStorage.setItem(REFRESH_TOKEN_KEY, 'concurrent-refresh');
      let resolvePost!: (value: { accessToken: string; refreshToken: string }) => void;
      const postPromise = new Promise<{ accessToken: string; refreshToken: string }>((resolve) => {
        resolvePost = resolve;
      });
      // firstValueFrom necesita un Observable real — from(promise) basta para el caso.
      const http = makeHttp({ post: vi.fn().mockReturnValue(from(postPromise)) });
      const auth = new AuthService(http);

      const call1 = auth.refresh();
      const call2 = auth.refresh();
      const call3 = auth.refresh('concurrent-refresh');

      resolvePost({ accessToken: 'access-shared', refreshToken: 'refresh-shared' });
      const [t1, t2, t3] = await Promise.all([call1, call2, call3]);

      expect(t1).toBe('access-shared');
      expect(t2).toBe('access-shared');
      expect(t3).toBe('access-shared');
      // Una sola petición HTTP real pese a las tres llamadas concurrentes.
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('una vez resuelta la llamada en curso, la siguiente dispara una petición nueva', async () => {
      localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-a');
      const http = makeHttp({
        post: vi.fn()
          .mockReturnValueOnce(of({ accessToken: 'access-a', refreshToken: 'refresh-b' }))
          .mockReturnValueOnce(of({ accessToken: 'access-b', refreshToken: 'refresh-c' })),
      });
      const auth = new AuthService(http);

      await auth.refresh();
      await auth.refresh();

      expect(http.post).toHaveBeenCalledTimes(2);
    });
  });

  describe('refresh — sincroniza el alcance de la sesión con el token nuevo', () => {
    /** JWT con la forma del backend (header.payload.firma); la firma no se comprueba en el frontend. */
    function fakeJwt(payload: object): string {
      const b64url = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      return `eyJhbGciOiJIUzI1NiJ9.${b64url}.firma`;
    }

    async function loggedInAs(estateIds: string[], http: HttpClient): Promise<AuthService> {
      const auth = new AuthService(http);
      await auth.login('ana@demo.app', 'secret');
      expect(auth.currentUser()?.estateIds).toEqual(estateIds);
      return auth;
    }

    it('tras crear una finca, el nuevo token añade su id a currentUser().estateIds y conserva el resto del usuario', async () => {
      const post = vi.fn()
        .mockReturnValueOnce(of({
          accessToken: 'access-login', refreshToken: 'refresh-1',
          user: { id: 'u1', fullName: 'Ana Gestora', role: 'B', estateIds: ['e1'], administratorId: 'a1', subscriptionStatus: 'Activa' },
        }))
        .mockReturnValueOnce(of({
          accessToken: fakeJwt({ sub: 'u1', role: 'B', estateIds: ['e1', 'e-nueva'], administratorId: 'a1' }),
          refreshToken: 'refresh-2',
        }));
      const auth = await loggedInAs(['e1'], makeHttp({ post }));

      await auth.reloadSession();

      expect(auth.currentUser()?.estateIds).toEqual(['e1', 'e-nueva']);
      expect(auth.currentUser()?.fullName).toBe('Ana Gestora');
      expect(auth.currentUser()?.subscriptionStatus).toBe('Activa');
    });

    it('un token con forma inesperada no toca al usuario (mejor datos viejos que datos rotos)', async () => {
      const post = vi.fn()
        .mockReturnValueOnce(of({
          accessToken: 'access-login', refreshToken: 'refresh-1',
          user: { id: 'u1', fullName: 'Ana Gestora', role: 'B', estateIds: ['e1'], administratorId: 'a1' },
        }))
        .mockReturnValueOnce(of({ accessToken: 'no-es-un-jwt', refreshToken: 'refresh-2' }));
      const auth = await loggedInAs(['e1'], makeHttp({ post }));

      await auth.reloadSession();

      expect(auth.currentUser()?.estateIds).toEqual(['e1']);
      expect(auth.accessToken()).toBe('no-es-un-jwt');
    });

    it('sin sesión iniciada, refrescar no inventa un usuario', async () => {
      localStorage.setItem(REFRESH_TOKEN_KEY, 'r');
      const http = makeHttp({
        post: vi.fn().mockReturnValue(of({
          accessToken: fakeJwt({ sub: 'u1', role: 'B', estateIds: ['e1'], administratorId: 'a1' }),
          refreshToken: 'r2',
        })),
      });
      const auth = new AuthService(http);

      await auth.refresh();

      expect(auth.currentUser()).toBeNull();
    });
  });

  describe('logout', () => {
    it('limpia el estado local aunque falle la revocación en el servidor', async () => {
      localStorage.setItem(REFRESH_TOKEN_KEY, 'refresh-x');
      const http = makeHttp({
        post: vi.fn().mockReturnValue(throwError(() => new Error('network down'))),
      });
      const auth = new AuthService(http);

      await auth.logout();

      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.accessToken()).toBeNull();
      expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    });

    it('sin refresh token persistido, no llama al backend', async () => {
      const http = makeHttp();
      const auth = new AuthService(http);

      await auth.logout();

      expect(http.post).not.toHaveBeenCalled();
    });
  });
});
