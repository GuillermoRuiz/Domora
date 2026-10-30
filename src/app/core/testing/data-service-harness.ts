import { TestBed } from '@angular/core/testing';
import type { Type } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService, AuthenticatedUser } from '../auth.service';
import { environment } from '../../../environments/environment';

/**
 * Harness compartido para probar a fondo cualquier servicio de acceso a
 * datos de `core/` — cada uno de los servicios por dominio en los que se
 * partió el antiguo `DataService` (ver `sprightly-snacking-yao.md`) usa
 * este mismo helper. El servicio inyecta `ApiClientService`/`AuthService`
 * por campo (`inject()`), así que hace falta un TestBed real — pero
 * `HttpTestingController` es además la herramienta correcta para esto:
 * permite afirmar la URL/verbo/cuerpo exactos de cada petición y controlar
 * la respuesta cruda tal cual la manda la API (con los enums sin acentos
 * de Prisma, Decimal como string, etc.), que es justo lo que hace falta
 * para probar los mapeos de verdad.
 */
export const API = environment.apiBaseUrl;

export interface ApiServiceHarness<T> {
  service: T;
  http: HttpTestingController;
  /** Cambia el usuario que devuelve `auth.currentUser()` — algunos métodos dependen de él (listOwnerProperties, listMembershipsByUser...). */
  setCurrentUser: (user: AuthenticatedUser | null) => void;
}

export function setupApiService<T>(serviceType: Type<T>, initialUser: AuthenticatedUser | null = null): ApiServiceHarness<T> {
  let currentUser = initialUser;
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: { currentUser: () => currentUser } },
    ],
  });
  const service = TestBed.inject(serviceType);
  const http = TestBed.inject(HttpTestingController);
  return {
    service,
    http,
    setCurrentUser: (user: AuthenticatedUser | null) => {
      currentUser = user;
    },
  };
}

export function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'u1',
    fullName: 'Usuario de prueba',
    role: 'B',
    estateIds: ['e1'],
    administratorId: 'admin1',
    ...overrides,
  };
}
