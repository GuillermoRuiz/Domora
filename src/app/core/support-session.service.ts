import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { AuthService } from './auth.service';
import { DespachoContextService } from './despacho-context.service';
import type { SupportSession } from './models';

/**
 * 403 messages of the backend `SupportAccessGuard` (backend/src/support-access/support-access.guard.ts,
 * `SUPPORT_MESSAGES`) that the user can fix by starting or restarting support mode.
 * Keep them identical to the backend copy.
 */
export const SUPPORT_MESSAGES = {
  noSession: 'Estás en modo consulta. Para modificar datos de un despacho inicia una sesión de soporte.',
  invalidSession: 'La sesión de soporte no es válida, ha terminado o ha caducado. Inicia una nueva.',
  otherDespacho: 'La sesión de soporte activa es de otro despacho. Inicia una sesión de soporte para este despacho.',
} as const;

const MAX_TIMEOUT_MS = 2_147_483_647;

export interface StartSupportSessionInput {
  reason: string;
  ticketRef?: string;
}

/**
 * Support mode of role A on the selected despacho (odd/tasks/role-a-panel.md S5). Role A is
 * read-only on client data; writes need an open support session, sent by
 * `supportSessionInterceptor` as `X-Support-Session`. The session is restored from the API when a
 * despacho is selected and dropped when it expires, ends, or the backend says it is no longer valid.
 */
@Injectable({ providedIn: 'root' })
export class SupportSessionService {
  private readonly api = inject(ApiClientService);
  private readonly auth = inject(AuthService);
  private readonly despacho = inject(DespachoContextService);

  private readonly session = signal<SupportSession | null>(null);
  private expiryTimer?: ReturnType<typeof setTimeout>;
  /** Ignores restore answers that arrive after the despacho changed or the session was dropped. */
  private restoreVersion = 0;

  /** Message of the last support denial (403), until the user starts a session or dismisses it. */
  readonly denial = signal<string | null>(null);

  /** The open session for the selected despacho, or `null`. */
  readonly active = computed<SupportSession | null>(() => {
    const session = this.session();
    const user = this.auth.currentUser();
    if (!session || !user || user.role !== 'A') return null;
    return session.administratorId === this.despacho.selected()?.id ? session : null;
  });

  constructor() {
    let previousUserId: string | null = null;
    effect(() => {
      const user = this.auth.currentUser();
      const despachoId = this.despacho.selected()?.id ?? null;
      untracked(() => {
        // Leaving the despacho of an open session (another despacho, «Salir», any clear) ends it on
        // the server so the audit shows its real duration (T15). Best effort: a failure never blocks
        // and the session is dropped locally anyway (it still expires server-side). After logout the
        // access token is already gone, so no call is possible; a reload starts without a session.
        const open = this.session();
        if (open && user?.role === 'A' && user.id === previousUserId && open.administratorId !== despachoId) {
          this.api.post(`/support-sessions/${open.id}/end`, {}).catch(() => undefined);
        }
        previousUserId = user?.id ?? null;
        this.drop();
        this.denial.set(null);
        if (user?.role === 'A' && despachoId) void this.restore(despachoId);
      });
    });
  }

  async start(input: StartSupportSessionInput): Promise<SupportSession> {
    const administratorId = this.despacho.selected()?.id;
    if (!administratorId) throw new Error('No hay ningún despacho seleccionado.');
    const ticketRef = input.ticketRef?.trim();
    const session = await this.api.post<SupportSession>('/support-sessions', {
      administratorId,
      reason: input.reason.trim(),
      ...(ticketRef ? { ticketRef } : {}),
    });
    this.restoreVersion++;
    this.keep(session);
    this.denial.set(null);
    return session;
  }

  async end(): Promise<void> {
    const session = this.active();
    if (!session) return;
    await this.api.post<SupportSession>(`/support-sessions/${session.id}/end`, {});
    this.drop();
  }

  /**
   * Handles a 403 message from the API. Returns `true` when it is a support denial: it is surfaced
   * through `denial` and, when the session is no longer valid, the session is dropped.
   */
  handleForbidden(message: unknown): boolean {
    if (typeof message !== 'string') return false;
    if (!(Object.values(SUPPORT_MESSAGES) as string[]).includes(message)) return false;
    if (message === SUPPORT_MESSAGES.invalidSession) this.drop();
    this.denial.set(message);
    return true;
  }

  dismissDenial(): void {
    this.denial.set(null);
  }

  private async restore(despachoId: string): Promise<void> {
    const version = ++this.restoreVersion;
    try {
      const sessions = await this.api.get<SupportSession[]>('/support-sessions/active');
      if (version !== this.restoreVersion) return;
      const now = Date.now();
      const match = sessions.find((s) => s.administratorId === despachoId && Date.parse(s.expiresAt) > now);
      if (match) this.keep(match);
    } catch {
      // Without the restore the band stays in read-only mode; the user can start a new session.
    }
  }

  private keep(session: SupportSession): void {
    clearTimeout(this.expiryTimer);
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (!(remaining > 0)) {
      this.session.set(null);
      return;
    }
    this.session.set(session);
    // setTimeout overflows above ~24.8 days (it would fire at once): wait in steps and re-check.
    this.expiryTimer = setTimeout(() => {
      if (this.session()?.id === session.id) this.keep(session);
    }, Math.min(remaining, MAX_TIMEOUT_MS));
  }

  private drop(): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.restoreVersion++;
    this.session.set(null);
  }
}
