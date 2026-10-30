import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { Role } from './models';

const REFRESH_TOKEN_KEY = 'domora-refresh-token';

/** El identificador de Prisma llega como `Periodo_de_gracia` (sin espacios) — se normaliza al recibirlo. */
export type SubscriptionStatus = 'Activa' | 'Periodo de gracia' | 'Vencida' | 'Bloqueada';

const SUBSCRIPTION_STATUS_FROM_API: Record<string, SubscriptionStatus> = {
  Activa: 'Activa', Periodo_de_gracia: 'Periodo de gracia', Vencida: 'Vencida', Bloqueada: 'Bloqueada',
};

export interface AuthenticatedUser {
  id: string;
  fullName: string;
  role: Role;
  estateIds: string[];
  administratorId: string | null;
  /** Solo poblado para rol B. Informativo: quien de verdad corta el acceso es el backend (SubscriptionStatusGuard). */
  subscriptionStatus?: SubscriptionStatus;
}

/** Shape tal cual la manda la API — `subscriptionStatus` todavía sin normalizar. */
interface RawAuthenticatedUser extends Omit<AuthenticatedUser, 'subscriptionStatus'> {
  subscriptionStatus?: string;
}

function normalizeUser(raw: RawAuthenticatedUser): AuthenticatedUser {
  return {
    ...raw,
    subscriptionStatus: raw.subscriptionStatus
      ? (SUBSCRIPTION_STATUS_FROM_API[raw.subscriptionStatus] ?? undefined)
      : undefined,
  };
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: RawAuthenticatedUser;
}

interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

type AccessClaims = Pick<AuthenticatedUser, 'role' | 'estateIds' | 'administratorId'>;

/**
 * Lee los claims de alcance del access token (payload base64url, sin
 * verificar firma — eso lo hace el backend; aquí solo se sincroniza la UI).
 * Devuelve null si el token no tiene la forma esperada.
 */
function decodeAccessClaims(token: string): AccessClaims | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    if (!Array.isArray(claims.estateIds) || typeof claims.role !== 'string') return null;
    return { role: claims.role, estateIds: claims.estateIds, administratorId: claims.administratorId ?? null };
  } catch {
    return null;
  }
}

// El access token vive solo en memoria (nunca en localStorage) — el
// refresh token, al ser de un solo uso y revocable server-side, es el único
// que se persiste para sobrevivir a un refresh de página.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly accessTokenSignal = signal<string | null>(null);
  private readonly currentUserSignal = signal<AuthenticatedUser | null>(null);

  readonly accessToken = this.accessTokenSignal.asReadonly();
  readonly currentUser = this.currentUserSignal.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUserSignal() !== null);

  constructor(private readonly http: HttpClient) {}

  async login(email: string, password: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, { email, password }),
    );
    this.setSession(response);
  }

  /** Auto-registro abierto (rol C) — deja la sesión iniciada, igual que login(). */
  async register(email: string, password: string, fullName: string, termsAccepted: boolean): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiBaseUrl}/auth/register`, {
        email,
        password,
        fullName,
        termsAccepted,
      }),
    );
    this.setSession(response);
  }

  /** Público — solo para mostrar a quién se está uniendo antes de pedir contraseña. */
  getAdminInviteInfo(token: string): Promise<{ administratorName: string }> {
    return firstValueFrom(
      this.http.get<{ administratorName: string }>(`${environment.apiBaseUrl}/auth/admin-invites/${token}`),
    );
  }

  /** Canjea la invitación (rol B) — deja la sesión iniciada, igual que login()/register(). */
  async redeemAdminInvite(token: string, email: string, password: string, fullName: string, termsAccepted: boolean): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiBaseUrl}/auth/admin-invites/${token}/redeem`, {
        email,
        password,
        fullName,
        termsAccepted,
      }),
    );
    this.setSession(response);
  }

  /** Público — solo para mostrar a qué gestora se está uniendo antes de pedir contraseña. */
  getTeamInviteInfo(token: string): Promise<{ administratorName: string }> {
    return firstValueFrom(
      this.http.get<{ administratorName: string }>(`${environment.apiBaseUrl}/auth/team-invites/${token}`),
    );
  }

  /** Canjea la invitación de equipo — deja la sesión iniciada, igual que login()/register(). */
  async redeemTeamInvite(token: string, email: string, password: string, fullName: string, termsAccepted: boolean): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<LoginResponse>(`${environment.apiBaseUrl}/auth/team-invites/${token}/redeem`, {
        email,
        password,
        fullName,
        termsAccepted,
      }),
    );
    this.setSession(response);
  }

  /** Respuesta siempre genérica (exista o no ese email) — el backend nunca revela qué emails están registrados. */
  requestPasswordReset(email: string): Promise<{ message: string }> {
    return firstValueFrom(
      this.http.post<{ message: string }>(`${environment.apiBaseUrl}/auth/forgot-password`, { email }),
    );
  }

  checkPasswordResetToken(token: string): Promise<{ valid: true }> {
    return firstValueFrom(
      this.http.get<{ valid: true }>(`${environment.apiBaseUrl}/auth/forgot-password/${token}`),
    );
  }

  /** No inicia sesión — a diferencia de register/redeem-invite, tras un reset se pide iniciar sesión de nuevo. */
  async resetPassword(token: string, password: string): Promise<void> {
    await firstValueFrom(
      this.http.post(`${environment.apiBaseUrl}/auth/reset-password`, { token, password }),
    );
  }

  // Intenta recuperar la sesión a partir del refresh token persistido —
  // se llama al arrancar la app (APP_INITIALIZER) para no perder la sesión
  // al recargar la página, ya que el access token solo vive en memoria.
  async restoreSession(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return;
    try {
      await this.refresh(refreshToken);
      const user = await firstValueFrom(
        this.http.get<RawAuthenticatedUser>(`${environment.apiBaseUrl}/auth/me`),
      );
      this.currentUserSignal.set(normalizeUser(user));
    } catch {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      this.accessTokenSignal.set(null);
      this.currentUserSignal.set(null);
    }
  }

  // El refresh token es de un solo uso — si dos peticiones concurrentes
  // reciben un 401 a la vez (p. ej. sidebar + página cargando datos en
  // paralelo), cada una llamando a refresh() por su cuenta consumiría el
  // mismo token dos veces y la segunda fallaría. Se comparte la misma
  // promesa en curso entre todas las llamadas concurrentes.
  private refreshInFlight: Promise<string> | null = null;

  async refresh(refreshToken?: string): Promise<string> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.performRefresh(refreshToken).finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async performRefresh(refreshToken?: string): Promise<string> {
    const token = refreshToken ?? localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!token) throw new Error('No hay refresh token disponible');

    const response = await firstValueFrom(
      this.http.post<RefreshResponse>(`${environment.apiBaseUrl}/auth/refresh`, { refreshToken: token }),
    );
    this.accessTokenSignal.set(response.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refreshToken);
    // Los guards de ruta leen `currentUser().estateIds`: sin esto, una finca
    // recién creada (o una propiedad recién vinculada) seguiría invisible
    // aunque el token nuevo ya la incluya.
    const claims = decodeAccessClaims(response.accessToken);
    if (claims) {
      this.currentUserSignal.update((user) => (user ? { ...user, ...claims } : user));
    }
    return response.accessToken;
  }

  /**
   * Reemite el token para que refleje cambios de alcance hechos en esta
   * misma sesión (alta de finca, canje de invitación). `estateIds` solo se
   * calcula al emitir el token, así que sin esto la finca nueva rebota.
   */
  async reloadSession(): Promise<void> {
    await this.refresh();
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this.accessTokenSignal.set(null);
    this.currentUserSignal.set(null);
    if (refreshToken) {
      try {
        await firstValueFrom(
          this.http.post(`${environment.apiBaseUrl}/auth/logout`, { refreshToken }),
        );
      } catch {
        // El logout local ya se ha aplicado; un fallo de red al revocar el
        // refresh token en el servidor no debe bloquear al usuario.
      }
    }
  }

  private setSession(response: LoginResponse): void {
    this.accessTokenSignal.set(response.accessToken);
    this.currentUserSignal.set(normalizeUser(response.user));
    localStorage.setItem(REFRESH_TOKEN_KEY, response.refreshToken);
  }
}
