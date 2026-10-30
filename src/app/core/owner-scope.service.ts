import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';
import { MembershipsMessagingService } from './memberships-messaging.service';
import { PropertiesService } from './properties.service';
import type { PropertyView } from './models';

/** Una propiedad del propietario, lo justo para elegirla en la cabecera de «Mi comunidad». */
export interface ScopeProperty {
  id: string;
  nickname: string;
  addressFull: string;
  /** null si la propiedad aún no tiene finca. */
  estateId: string | null;
  estateName: string | null;
  isLinked: boolean;
  /** IBAN de la comunidad, para las instrucciones de transferencia de «Pagar». */
  estateIban?: string | null;
}

/** Propiedades de una misma finca (el selector las agrupa así). */
export interface ScopeGroup {
  estateId: string | null;
  estateName: string;
  properties: ScopeProperty[];
}

const NO_ESTATE = 'Sin comunidad vinculada';
const storageKey = (userId: string) => `domora.ownerScope.${userId}`;
/** Stored choice for «Todas mis propiedades». */
const ALL = 'all';

const byName = (a: string, b: string) => a.localeCompare(b, 'es', { numeric: true });

/**
 * La propiedad que el propietario está viendo en «Mi comunidad» (el «ámbito»).
 * La finca se deduce de ella. Se recuerda entre visitas, por usuario; si la
 * recordada ya no existe se vuelve a «Todas» (con varias) o a la única.
 */
@Injectable({ providedIn: 'root' })
export class OwnerScopeService {
  private memberships = inject(MembershipsMessagingService);
  private propertiesApi = inject(PropertiesService);
  private auth = inject(AuthService);

  readonly items = signal<ScopeProperty[]>([]);
  readonly loaded = signal(false);
  readonly failed = signal(false);
  private readonly selectedId = signal<string | null>(null);

  /** «Todas mis propiedades» solo tiene sentido con más de una. */
  readonly showAll = computed(() => this.items().length > 1);
  /** Viendo todas las propiedades a la vez (como «Todas mis comunidades» de la gestora). */
  readonly isAll = computed(() => this.showAll() && !this.items().some(p => p.id === this.selectedId()));

  /** La propiedad elegida; null viendo «Todas» o sin propiedades. Con una sola, esa. */
  readonly selected = computed<ScopeProperty | null>(() => {
    if (this.isAll()) return null;
    const items = this.items();
    return items.find(p => p.id === this.selectedId()) ?? this.groups()[0]?.properties[0] ?? items[0] ?? null;
  });

  /** Fincas por nombre (las propiedades sin finca, al final) y, dentro, propiedades por nombre. */
  readonly groups = computed<ScopeGroup[]>(() => {
    const byEstate = new Map<string | null, ScopeGroup>();
    for (const p of this.items()) {
      const group = byEstate.get(p.estateId) ?? { estateId: p.estateId, estateName: p.estateName ?? NO_ESTATE, properties: [] };
      group.properties.push(p);
      byEstate.set(p.estateId, group);
    }
    const groups = [...byEstate.values()];
    for (const g of groups) g.properties.sort((a, b) => byName(a.nickname, b.nickname));
    return groups.sort((a, b) => (a.estateId === null ? 1 : b.estateId === null ? -1 : byName(a.estateName, b.estateName)));
  });

  /** Carga las propiedades del usuario y restaura la que eligió la última vez. */
  async load(): Promise<void> {
    try {
      const memberships = await this.memberships.listMembershipsByUser();
      const views = await Promise.all(memberships.map(m => this.propertiesApi.resolvePropertyView(m.propertyId)));
      this.items.set(views.filter((v): v is PropertyView => v !== null).map(toScopeProperty));
      this.failed.set(false);
      this.selectedId.set(this.restore());
    } catch (error) {
      console.error('Error cargando las propiedades del propietario', error);
      // Si ya había propiedades se conservan: solo falló la recarga.
      if (!this.loaded()) this.failed.set(true);
    } finally {
      this.loaded.set(true);
    }
  }

  /** Elige una propiedad, o «Todas» con null. */
  select(propertyId: string | null): void {
    if (propertyId === null) {
      if (!this.showAll()) return;
      this.selectedId.set(ALL);
      this.persist(ALL);
      return;
    }
    if (!this.items().some(p => p.id === propertyId)) return;
    this.selectedId.set(propertyId);
    this.persist(propertyId);
  }

  private restore(): string | null {
    const userId = this.auth.currentUser()?.id;
    if (!userId) return this.selectedId();
    try {
      const saved = localStorage.getItem(storageKey(userId));
      if (saved && this.items().some(p => p.id === saved)) return saved;
    } catch {
      // Sin almacenamiento (modo privado, bloqueado): se usa la primera.
    }
    return this.selectedId() && this.items().some(p => p.id === this.selectedId()) ? this.selectedId() : null;
  }

  private persist(propertyId: string): void {
    const userId = this.auth.currentUser()?.id;
    if (!userId) return;
    try {
      localStorage.setItem(storageKey(userId), propertyId);
    } catch {
      // La elección sigue valiendo en esta sesión aunque no se pueda recordar.
    }
  }
}

function toScopeProperty(view: PropertyView): ScopeProperty {
  return {
    id: view.property.id,
    nickname: view.nickname,
    addressFull: view.addressFull,
    estateId: view.property.estateId,
    estateName: view.estateName,
    isLinked: view.isLinked,
    estateIban: view.estate?.iban ?? null,
  };
}
