import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';
import { AuthService } from './auth.service';
import {
  OwnerProperty, PropertyView, ExternalOwner, EstateOnboardingRequest,
  OwnerPropertyType, ViaType, MembershipRoleType, CoefficientAreaPreview,
} from './models';

/** Campos Decimal de Property que la API serializa como string ("2.50"). */
const DECIMAL_FIELDS = ['participationQuota', 'builtAreaM2'] as const;

/**
 * La API serializa los Decimal de Prisma como string — el coeficiente de
 * participación y la superficie se normalizan aquí a número (o null) para
 * poder formatearlos y sumarlos sin que cada pantalla haga su propio
 * `Number()`. Solo se tocan las claves que vienen en la respuesta.
 */
function mapProperty<T>(p: T): T {
  if (!p || typeof p !== 'object') return p;
  let out: Record<string, unknown> | null = null;
  for (const key of DECIMAL_FIELDS) {
    if (!(key in p)) continue;
    const raw = (p as Record<string, unknown>)[key];
    out ??= { ...(p as Record<string, unknown>) };
    out[key] = raw == null ? null : Number(raw);
  }
  return (out ?? p) as T;
}

/** Propiedades (entidad canónica unificada), su vista resuelta de FKs, altas de comunidad nueva y propietarios externos. */
@Injectable({ providedIn: 'root' })
export class PropertiesService {
  private api = inject(ApiClientService);
  private auth = inject(AuthService);

  // ── Properties ───────────────────────────────────────────────────────────
  /**
   * Lista las propiedades del propietario en sesión — derivadas de sus
   * membresías activas (GET /users/:id/memberships incluye la property).
   */
  async listOwnerProperties(): Promise<OwnerProperty[]> {
    const userId = this.auth.currentUser()?.id;
    if (!userId) return [];
    const memberships = await this.api.get<any[]>(`/users/${userId}/memberships`);
    const seen = new Set<string>();
    const out: OwnerProperty[] = [];
    for (const m of memberships) {
      const p = m.property;
      if (p && !seen.has(p.id)) {
        seen.add(p.id);
        out.push(mapProperty(p));
      }
    }
    return out;
  }

  async listPropertiesByEstate(estateId: string): Promise<OwnerProperty[]> {
    const raw = await this.api.get<OwnerProperty[]>(`/estates/${estateId}/properties`);
    const props = raw.map(mapProperty);
    return props.sort((a, b) => {
      const sA = `${a.staircase ?? ''}-${a.floor ?? ''}-${a.door ?? ''}`;
      const sB = `${b.staircase ?? ''}-${b.floor ?? ''}-${b.door ?? ''}`;
      return sA.localeCompare(sB);
    });
  }

  async findOwnerPropertyById(id: string): Promise<OwnerProperty | null> {
    const property = await this.api.getOrNull<OwnerProperty>(`/properties/${id}`);
    return property ? mapProperty(property) : property;
  }

  findPropertyById(id: string): Promise<OwnerProperty | null> {
    return this.findOwnerPropertyById(id);
  }

  /**
   * Alta de propiedad (rol C). Si se indica `estateId`, además abre una
   * solicitud de adhesión a esa finca (queda pendiente de aprobación por un
   * rol B) — la propiedad en sí se crea siempre, se vea o no vinculada.
   */
  createOwnerProperty(payload: {
    type: OwnerPropertyType;
    roleType: MembershipRoleType;
    viaType?: ViaType;
    viaName?: string;
    streetNumber?: string;
    staircase?: string;
    floor?: string;
    door?: string;
    municipality?: string;
    province?: string;
    country?: string;
    estateId?: string;
  }): Promise<OwnerProperty> {
    return this.api.post<OwnerProperty>('/properties', payload);
  }

  /**
   * `participationQuota` solo lo acepta el backend si quien llama es la
   * gestora de la finca (o rol A) — un propietario que lo mande recibe 403.
   */
  async updateOwnerProperty(id: string, patch: Partial<OwnerProperty>): Promise<OwnerProperty> {
    return mapProperty(await this.api.patch<OwnerProperty>(`/properties/${id}`, patch));
  }

  /**
   * Alta directa dentro de una finca ya gestionada (botón "Nueva
   * propiedad" en estate-detail, rol B/A) — a diferencia de
   * `createOwnerProperty`, queda vinculada a la finca de inmediato, sin
   * AdhesionRequest ni titular todavía.
   */
  async createEstateProperty(estateId: string, payload: {
    type: OwnerPropertyType;
    viaType?: ViaType;
    viaName?: string;
    streetNumber?: string;
    staircase?: string;
    floor?: string;
    door?: string;
    municipality?: string;
    province?: string;
    quotaMonthly?: number;
    participationQuota?: number;
    builtAreaM2?: number;
  }): Promise<OwnerProperty> {
    return mapProperty(await this.api.post<OwnerProperty>(`/estates/${estateId}/properties`, payload));
  }

  /** Previsualiza el reparto de coeficientes proporcional a m² — no escribe nada. */
  previewQuotasByArea(estateId: string): Promise<CoefficientAreaPreview> {
    return this.api.post<CoefficientAreaPreview>(`/estates/${estateId}/properties/coefficients/preview-by-area`, {});
  }

  /** Aplica el reparto de `previewQuotasByArea` (el backend lo recalcula de nuevo, no confía en este preview). */
  applyQuotasByArea(estateId: string): Promise<OwnerProperty[]> {
    return this.api.post<OwnerProperty[]>(`/estates/${estateId}/properties/coefficients/apply-by-area`, {});
  }

  /**
   * Cola de revisión manual (rol A/soporte) para altas de comunidad NUEVA
   * sin gestora todavía — no crea una finca automáticamente, ver
   * doc/frontend-zoneless-audit-guide.md §5.2.
   */
  createEstateOnboardingRequest(payload: {
    propertyId?: string;
    communityName: string;
    communityAddress?: string;
    adminName?: string;
    adminEmail?: string;
  }): Promise<void> {
    return this.api.post<void>('/estate-onboarding-requests', payload);
  }

  /** Solo rol A — cola de soporte de altas de comunidad nueva. */
  async listEstateOnboardingRequests(): Promise<EstateOnboardingRequest[]> {
    const rows = await this.api.get<any[]>('/estate-onboarding-requests');
    return rows.map((r): EstateOnboardingRequest => ({
      id: r.id,
      communityName: r.communityName,
      communityAddress: r.communityAddress,
      adminName: r.adminName,
      adminEmail: r.adminEmail,
      status: r.status,
      createdAt: d(r.createdAt),
      requestedByName: r.requestedByUser?.fullName ?? '—',
      requestedByEmail: r.requestedByUser?.email ?? '—',
    }));
  }

  resolveEstateOnboardingRequest(id: string, status: 'contacted' | 'dismissed'): Promise<void> {
    return this.api.patch<void>(`/estate-onboarding-requests/${id}`, { status });
  }

  deleteOwnerProperty(id: string): Promise<void> {
    return this.api.delete<void>(`/properties/${id}`);
  }

  // ── Property view (resolución de FKs) ────────────────────────────────────
  async resolvePropertyView(propertyId: string, viewerUserId?: string): Promise<PropertyView | null> {
    const v = await this.api.getOrNull<any>(`/properties/${propertyId}/view`, { viewerUserId });
    if (!v) return null;
    return { ...v, property: mapProperty(v.property) };
  }

  /**
   * Formatea la dirección postal a partir de los campos catastrales.
   * Helper puro — se mantiene síncrono.
   */
  formatPostalAddress(p: OwnerProperty): string {
    if (!p.viaType && !p.viaName) return '';
    const number = [p.streetNumber, p.streetNumberSuffix].filter(Boolean).join('');
    const line1 = [p.viaType, p.viaName].filter(Boolean).join(' ') + (number ? `, ${number}` : '');
    const unit = [
      p.staircase ? `esc. ${p.staircase}` : null,
      p.floor ? `${p.floor}º` : null,
      p.door ? p.door : null,
    ].filter(Boolean).join(' ');
    return unit ? `${line1}, ${unit}` : line1;
  }

  // ── External owners ─────────────────────────────────────────────────────
  // TODO(backend): no existe endpoint de external-owner por propertyId;
  // solo GET /estates/:estateId/external-owners y GET /external-owners/:id.
  async findExternalOwner(propertyId: string): Promise<ExternalOwner | null> {
    return null;
  }

  listExternalOwnersByEstate(estateId: string): Promise<ExternalOwner[]> {
    return this.api.get<ExternalOwner[]>(`/estates/${estateId}/external-owners`);
  }

  /** Alta manual de un propietario sin cuenta (rol A/B). El backend lo guarda siempre como Propietario. */
  createExternalOwner(propertyId: string, payload: {
    fullName: string;
    taxId?: string;
    email?: string;
    phone?: string;
  }): Promise<ExternalOwner> {
    return this.api.post<ExternalOwner>(`/properties/${propertyId}/external-owners`, payload);
  }
}
