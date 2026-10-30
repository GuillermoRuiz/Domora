import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from './auth.service';
import type { DespachoRef } from './models';

export const DESPACHO_CONTEXT_KEY = 'domora.despacho-context';

interface StoredDespacho extends DespachoRef {
  userId: string;
}

function readStored(): StoredDespacho | null {
  try {
    const raw = sessionStorage.getItem(DESPACHO_CONTEXT_KEY);
    return raw ? (JSON.parse(raw) as StoredDespacho) : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredDespacho | null): void {
  try {
    if (value) sessionStorage.setItem(DESPACHO_CONTEXT_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(DESPACHO_CONTEXT_KEY);
  } catch {
    // Without storage the selection only lives until the page reloads.
  }
}

/**
 * Despacho (client administrator) that role A is looking at (odd/tasks/role-a-panel.md S1).
 * Role B screens reused by role A read it through `TenantContextService.currentAdministratorId`,
 * so they scope to this despacho. Kept per browser tab (sessionStorage) and only for the role A
 * user who chose it; dropped on logout. Real enforcement stays server-side.
 */
@Injectable({ providedIn: 'root' })
export class DespachoContextService {
  private readonly auth = inject(AuthService);
  private readonly stored = signal<StoredDespacho | null>(readStored());

  /** The selected despacho, or `null` when none is selected or the user is not role A. */
  readonly selected = computed<DespachoRef | null>(() => {
    const stored = this.stored();
    const user = this.auth.currentUser();
    if (!stored || !user || user.role !== 'A' || stored.userId !== user.id) return null;
    return { id: stored.id, name: stored.name };
  });

  constructor() {
    // Before the session is restored the user is null too: only a user who was seen and then
    // left (logout) or a user who cannot hold the context clears it.
    let seenUser = false;
    effect(() => {
      const user = this.auth.currentUser();
      untracked(() => {
        if (user) seenUser = true;
        const leftSession = !user && seenUser;
        const notRoleA = !!user && user.role !== 'A';
        const otherUser = !!user && !!this.stored() && this.stored()!.userId !== user.id;
        if ((leftSession || notRoleA || otherUser) && this.stored()) this.clear();
      });
    });
  }

  select(despacho: DespachoRef): void {
    const user = this.auth.currentUser();
    if (!user || user.role !== 'A') return;
    const next: StoredDespacho = { userId: user.id, id: despacho.id, name: despacho.name };
    this.stored.set(next);
    writeStored(next);
  }

  clear(): void {
    this.stored.set(null);
    writeStored(null);
  }
}
