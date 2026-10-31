import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { CommunityScopeService } from './community-scope.service';
import { TenantContextService } from './tenant-context.service';
import { ESTATE_TYPE_FROM_API, ESTATE_TYPE_TO_API } from './api-shared';
import { Estate, EstateSepaBilling, EstateSetupStatus, EstateSetupSummary } from './models';
import { EstateOverview, EstateOverviewQuery, EstateManagementSearchResult } from './estate-overview.models';

/** Paleta curada — mismo criterio de contraste AA con texto blanco que el resto del tema. */
export const ESTATE_COLOR_PALETTE: string[] = [
  '#8B5E34', '#3B6E8F', '#4A7C59', '#7A4B8C', '#B0472B',
  '#2F6F6B', '#6B5B95', '#8C6A2F', '#4B6584', '#8E4A62',
];

/** Prisma Decimal llega como texto; null/undefined se conservan como null. */
const decimalOrNull = (value: unknown): number | null => (value == null || value === '' ? null : Number(value));

@Injectable({ providedIn: 'root' })
export class EstatesService {
  private api = inject(ApiClientService);
  private readonly communityScope = inject(CommunityScopeService);
  private readonly tenant = inject(TenantContextService);

  // reserveTarget es Decimal en Prisma -> string por JSON, mismo motivo que
  // mapAccountingEstate (AccountingService).
  private mapEstate(raw: any): Estate {
    return {
      ...raw,
      type: ESTATE_TYPE_FROM_API[raw.type] ?? raw.type,
      reserveTarget: Number(raw.reserveTarget ?? 0),
      parcelAreaM2: decimalOrNull(raw.parcelAreaM2),
      latitude: decimalOrNull(raw.latitude),
      longitude: decimalOrNull(raw.longitude),
    };
  }

  /** Color efectivo de la tarjeta: el elegido por el admin, o uno determinista por id. */
  estateColor(estate: Pick<Estate, 'id' | 'color'>): string {
    if (estate.color) return estate.color;
    let hash = 0;
    for (let i = 0; i < estate.id.length; i++) {
      hash = (hash * 31 + estate.id.charCodeAt(i)) >>> 0;
    }
    return ESTATE_COLOR_PALETTE[hash % ESTATE_COLOR_PALETTE.length];
  }

  async listEstates(): Promise<Estate[]> {
    const rows = await this.api.get<any[]>('/estates', this.tenant.estateListFilter());
    const estates = rows.map(r => this.mapEstate(r));
    this.communityScope.remember(estates);
    return estates;
  }

  async getOverview(query: EstateOverviewQuery): Promise<EstateOverview> {
    const result = await this.api.get<Omit<EstateOverview, 'items'> & { items: (Omit<EstateOverview['items'][number], 'balance' | 'pendingAmount'> & { balance: string; pendingAmount: string })[] }>('/estates/overview', {
      ...query, types: query.types.map(type => ESTATE_TYPE_TO_API[type]).join(','),
      ...this.tenant.estateListFilter(),
    });
    return { ...result, items: result.items.map(item => ({ ...item, type: ESTATE_TYPE_FROM_API[item.type] ?? item.type, balance: Number(item.balance), pendingAmount: Number(item.pendingAmount) })) };
  }

  downloadOverviewExcel(
    query: Omit<EstateOverviewQuery, "page" | "pageSize">,
  ): Promise<Blob> {
    const params = new URLSearchParams({
      search: query.search,
      filter: query.filter,
      types: query.types.map((type) => ESTATE_TYPE_TO_API[type]).join(","),
      sort: query.sort,
      direction: query.direction,
      ...this.tenant.estateListFilter(),
    });
    return this.api.getBlob(`/estates/overview/export.xlsx?${params}`);
  }

  searchManagement(q: string): Promise<EstateManagementSearchResult[]> {
    return this.api.get<EstateManagementSearchResult[]>('/estates/management-search', { q });
  }

  async findEstateById(id: string): Promise<Estate | null> {
    const raw = await this.api.getOrNull<any>(`/estates/${id}`);
    return raw ? this.mapEstate(raw) : null;
  }

  async createEstate(input: Omit<Estate, 'id' | 'administratorId'>): Promise<Estate> {
    const { name, type, address, streetNumber, location, province, postalCode, cadastralReference, reserveTarget, iban, color } = input;
    const raw = await this.api.post<any>('/estates', {
      name, type: ESTATE_TYPE_TO_API[type] ?? type, address, streetNumber, location,
      province, postalCode, cadastralReference,
      reserveTarget: reserveTarget ?? 0,
      iban,
      color,
    });
    return this.mapEstate(raw);
  }

  async updateEstate(id: string, patch: Partial<Estate>): Promise<Estate> {
    const body: Record<string, unknown> = { ...patch };
    if (typeof body['type'] === 'string') {
      body['type'] = ESTATE_TYPE_TO_API[body['type'] as string] ?? body['type'];
    }
    const raw = await this.api.patch<any>(`/estates/${id}`, body);
    return this.mapEstate(raw);
  }

  /** La foto subida de la finca. `version` (su `photoUpdatedAt`) evita que el navegador sirva una foto antigua tras cambiarla. */
  getEstatePhoto(id: string, version: string): Promise<Blob> {
    return this.api.getBlob(`/estates/${id}/photo?v=${encodeURIComponent(version)}`);
  }

  /** Sube (o sustituye) la foto de la finca; devuelve la finca ya con su `photoUpdatedAt`. */
  async uploadEstatePhoto(id: string, file: File): Promise<Estate> {
    return this.mapEstate(await this.api.uploadFile<any>(`/estates/${id}/photo`, file));
  }

  /** Quita la foto subida (la finca vuelve a la fachada del Catastro, si la hay). */
  async removeEstatePhoto(id: string): Promise<Estate> {
    return this.mapEstate(await this.api.delete<any>(`/estates/${id}/photo`));
  }

  getSetupStatus(estateId: string): Promise<EstateSetupStatus> {
    return this.api.get<EstateSetupStatus>(`/estates/${estateId}/setup-status`);
  }

  /**
   * Progreso de todas las fincas de la gestora, para el panel de fincas. El rol A
   * pide el del despacho seleccionado (sin selección, el backend devuelve []).
   */
  getSetupSummary(): Promise<EstateSetupSummary[]> {
    return this.api.get<EstateSetupSummary[]>('/estates/setup-summary', this.tenant.estateListFilter());
  }

  /** IBAN siempre enmascarado — ver EstateSepaBilling. */
  getEstateSepaBilling(estateId: string): Promise<EstateSepaBilling> {
    return this.api.get<EstateSepaBilling>(`/estates/${estateId}/sepa-billing`);
  }

  updateEstateSepaBilling(estateId: string, patch: {
    creditorId?: string; creditorIban?: string; creditorBic?: string; creditorPostalAddress?: string;
  }): Promise<EstateSepaBilling> {
    return this.api.patch<EstateSepaBilling>(`/estates/${estateId}/sepa-billing`, patch);
  }

  async getCreditorIdForEstate(estateId: string): Promise<string | null> {
    const estate = await this.findEstateById(estateId);
    return estate?.creditorId ?? null;
  }

  /** Validación puramente client-side — se mantiene síncrona. */
  isValidSpanishCreditorId(cid: string): boolean {
    if (!cid || cid.length !== 16) return false;
    if (!cid.startsWith('ES')) return false;
    const check = cid.substring(2, 4);
    const nif = cid.substring(7, 16);
    if (!/^\d{2}$/.test(check)) return false;
    if (!/^[A-Z]\d{7}[A-Z0-9]$/.test(nif)) return false;
    const rearranged = nif + 'ES' + check;
    const numeric = rearranged.split('').map(c => {
      const code = c.charCodeAt(0);
      if (code >= 48 && code <= 57) return c;
      return (code - 55).toString();
    }).join('');
    let remainder = 0;
    for (const ch of numeric) {
      remainder = (remainder * 10 + Number(ch)) % 97;
    }
    return remainder === 1;
  }
}
