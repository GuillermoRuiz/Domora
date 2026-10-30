import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, type CanActivateFn } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './auth.service';
import { TenantContextService } from './tenant-context.service';

const STORAGE_KEY = 'domora.community-scope';
const OPTIONS_KEY = 'domora.community-options';
/** Pantallas cuya URL ya lleva la comunidad: entrar en ellas fija la comunidad compartida. */
const ESTATE_ROUTE = /^\/b\/(?:estates|accounting)\/([^/?#]+)/;

/** `despachoId` is only set for role A: its choices belong to the despacho it was looking at (S1). */
interface StoredScope { userId: string; estateId: string | null; despachoId?: string | null; }
export interface EstateOption { id: string; name: string; }
interface StoredOptions { userId: string; estates: EstateOption[]; despachoId?: string | null; }

function readStored(): StoredScope | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as StoredScope : null;
  } catch { return null; }
}

function readOptions(): StoredOptions | null {
  try {
    const raw = sessionStorage.getItem(OPTIONS_KEY);
    return raw ? JSON.parse(raw) as StoredOptions : null;
  } catch { return null; }
}

/**
 * Comunidad elegida en el selector del header, compartida entre pantallas (Fincas, Juntas,
 * Incidencias, Tareas, Contabilidad, Mensajes e Informes). `null` significa «Todas mis comunidades».
 * Se guarda por usuario en sessionStorage y solo se devuelve si el usuario aún tiene acceso a ella.
 * Informes admite varias comunidades, pero fuera de Informes esa selección se reduce a «Todas».
 */
@Injectable({ providedIn: 'root' })
export class CommunityScopeService {
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantContextService);
  private readonly stored = signal<StoredScope | null>(readStored());

  private readonly options = signal<StoredOptions | null>(readOptions());

  /** Role A: the despacho being viewed. Roles B and C: `undefined`, so their stored choices match as before. */
  private readonly despachoKey = computed<string | null | undefined>(() =>
    this.auth.currentUser()?.role === 'A' ? this.tenant.currentAdministratorId() : undefined,
  );

  private matchesDespacho(stored: { despachoId?: string | null }): boolean {
    const key = this.despachoKey();
    return key === undefined || (stored.despachoId ?? null) === key;
  }

  /**
   * Últimas comunidades conocidas del usuario (id y nombre). Los selectores las pintan mientras llega su
   * propia lista, para que la comunidad elegida aparezca desde el primer fotograma y no parpadee «Todas».
   */
  readonly cachedEstates = computed<EstateOption[]>(() => {
    const options = this.options();
    const user = this.auth.currentUser();
    return options && user && options.userId === user.id && this.matchesDespacho(options) ? options.estates : [];
  });

  readonly estateId = computed<string | null>(() => {
    const stored = this.stored();
    const user = this.auth.currentUser();
    if (!stored?.estateId || !user || stored.userId !== user.id || !this.matchesDespacho(stored)) return null;
    return this.tenant.canAccessEstate(stored.estateId) ? stored.estateId : null;
  });

  /** La comunidad elegida con su nombre (tomado de las conocidas), o `null` si es «Todas». */
  readonly selected = computed<EstateOption | null>(() => {
    const id = this.estateId();
    if (!id) return null;
    return { id, name: this.cachedEstates().find(estate => estate.id === id)?.name ?? 'Comunidad seleccionada' };
  });

  constructor() {
    inject(Router).events.pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd)).subscribe(event => {
      const id = ESTATE_ROUTE.exec(event.urlAfterRedirects.split(/[?#]/)[0])?.[1];
      // Un segmento que no es una comunidad accesible no debe borrar la elegida.
      if (id && this.tenant.canAccessEstate(id)) this.select(id);
    });
  }

  private despachoField(): { despachoId?: string | null } {
    const key = this.despachoKey();
    return key === undefined ? {} : { despachoId: key };
  }

  remember(estates: readonly EstateOption[]): void {
    const user = this.auth.currentUser();
    if (!user || !estates.length) return;
    const next: StoredOptions = { userId: user.id, estates: estates.map(({ id, name }) => ({ id, name })), ...this.despachoField() };
    this.options.set(next);
    try { sessionStorage.setItem(OPTIONS_KEY, JSON.stringify(next)); } catch { /* solo se pierde al recargar */ }
  }

  /** `knownName` evita mostrar un nombre genérico cuando la comunidad aún no está en las conocidas. */
  select(estateId: string | null, knownName?: string): void {
    const user = this.auth.currentUser();
    if (!user) return;
    if (estateId && knownName && !this.cachedEstates().some(estate => estate.id === estateId)) {
      this.remember([...this.cachedEstates(), { id: estateId, name: knownName }]);
    }
    const next: StoredScope = { userId: user.id, estateId: estateId && this.tenant.canAccessEstate(estateId) ? estateId : null, ...this.despachoField() };
    this.stored.set(next);
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento: solo se pierde al recargar */ }
  }
}

/** En Fincas y Contabilidad, con una comunidad elegida la lista se sustituye por la ficha de esa comunidad. */
export const communityScopeRedirect = (base: '/b/estates' | '/b/accounting'): CanActivateFn => () => {
  const id = inject(CommunityScopeService).estateId();
  return id ? inject(Router).createUrlTree([base, id]) : true;
};
