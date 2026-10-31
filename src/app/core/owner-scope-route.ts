import { DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, type ParamMap } from '@angular/router';

import { OwnerScopeService } from './owner-scope.service';
import { StateService } from './state.service';

/** Query params that choose the scope: a property, or the first property of a community. */
export type OwnerScopeParam = 'propertyId' | 'estateId';

/**
 * Common wiring of the owner modules (Incidencias, Juntas, Recibos): loads the owner's properties (again whenever
 * one is added or removed) and applies `?propertyId=` / `?estateId=` from the URL once they are known, dropping those
 * params from the URL. An `estateId` keeps the current property when it is already in that community. Every
 * query param change is also handed to `onParams` (the module's own params: `issue`, `meeting`, `receipt`…).
 * Call it from the component's constructor.
 */
export function bindOwnerScopeToRoute(params: readonly OwnerScopeParam[], onParams?: (map: ParamMap) => void): void {
  const scope = inject(OwnerScopeService);
  const state = inject(StateService);
  const route = inject(ActivatedRoute);
  const router = inject(Router);
  const destroyRef = inject(DestroyRef);
  const requested = signal<Partial<Record<OwnerScopeParam, string>> | null>(null);

  effect(() => {
    state.propertiesVersion();
    void scope.load();
  });
  effect(() => {
    const wanted = requested();
    if (!wanted || !scope.loaded()) return;
    const items = scope.items();
    const byProperty = wanted.propertyId ? items.find((p) => p.id === wanted.propertyId) : undefined;
    const current = scope.isAll() ? null : scope.selected();
    untracked(() => {
      requested.set(null);
      if (byProperty) {
        if (current?.id !== byProperty.id) scope.select(byProperty.id);
        return;
      }
      if (!wanted.estateId || current?.estateId === wanted.estateId) return;
      const byEstate = items.find((p) => p.estateId === wanted.estateId);
      if (byEstate) scope.select(byEstate.id);
    });
  });
  route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((map) => {
    onParams?.(map);
    const wanted: Partial<Record<OwnerScopeParam, string>> = {};
    for (const name of params) {
      const value = map.get(name);
      if (value) wanted[name] = value;
    }
    if (Object.keys(wanted).length === 0) return;
    requested.set(wanted);
    const cleared = Object.fromEntries(params.map((name) => [name, null]));
    void router.navigate([], { relativeTo: route, queryParams: cleared, queryParamsHandling: 'merge', replaceUrl: true });
  });
}
