import { signal } from '@angular/core';
import { vi } from 'vitest';
import type { ScopeGroup, ScopeProperty } from '../owner-scope.service';

/**
 * An `OwnerScopeService` the owner-module specs control (the real one has its own tests): the same «Todas» rule
 * (only with more than one property), grouping by estate and `select`/`load` as spies.
 * Provide it with `{ provide: OwnerScopeService, useValue: fakeOwnerScope(items) }`.
 */
export function fakeOwnerScope(
  items: ScopeProperty[],
  opts: { selectedId?: string | null; loaded?: boolean; failed?: boolean } = {},
) {
  const selectedId = signal<string | null>(opts.selectedId !== undefined ? opts.selectedId : items[0]?.id ?? null);
  const groups = (): ScopeGroup[] => {
    const byEstate = new Map<string | null, ScopeGroup>();
    for (const p of items) {
      const group = byEstate.get(p.estateId) ?? { estateId: p.estateId, estateName: p.estateName ?? 'Sin comunidad vinculada', properties: [] };
      group.properties.push(p);
      byEstate.set(p.estateId, group);
    }
    return [...byEstate.values()];
  };
  const showAll = () => items.length > 1;
  const isAll = () => showAll() && !items.some((p) => p.id === selectedId());
  return {
    items: signal(items),
    loaded: signal(opts.loaded ?? true),
    failed: signal(opts.failed ?? false),
    showAll,
    isAll,
    selected: () => (isAll() ? null : items.find((p) => p.id === selectedId()) ?? null),
    groups,
    load: vi.fn(async () => undefined),
    select: vi.fn((id: string | null) => selectedId.set(id)),
  };
}
