import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import {
  CatastroImportResult, CatastroLookup, CatastroLookupQuery, CatastroProvince, CatastroStreet, CatastroUnit,
} from './models';

/**
 * Consulta de inmuebles al Catastro (vía el backend, que normaliza la
 * respuesta y protege el cupo de peticiones) e importación masiva de las
 * unidades de una finca. Solo gestora (B) y soporte (A).
 */
@Injectable({ providedIn: 'root' })
export class CatastroService {
  private api = inject(ApiClientService);

  /** Lee el Catastro y devuelve las unidades — NO escribe nada. */
  lookup(estateId: string, query: CatastroLookupQuery): Promise<CatastroLookup> {
    return this.api.post<CatastroLookup>(`/estates/${estateId}/catastro/lookup`, query);
  }

  /**
   * Crea las unidades ya revisadas. Idempotente por referencia catastral: las
   * que la finca ya tiene se omiten (`skipped`). Se envían solo los campos que
   * el backend acepta (nada de `alreadyImported`/`use`, que su validación
   * estricta rechazaría).
   */
  importUnits(
    estateId: string,
    payload: { parcelReference: string; fetchedAt: string; units: CatastroUnit[] },
  ): Promise<CatastroImportResult> {
    const { parcelReference, fetchedAt, units } = payload;
    return this.api.post<CatastroImportResult>(`/estates/${estateId}/catastro/import`, {
      parcelReference,
      fetchedAt,
      units: units.map((u) => ({
        cadastralReference: u.cadastralReference,
        type: u.type,
        viaType: u.viaType,
        viaName: u.viaName,
        streetNumber: u.streetNumber,
        streetNumberSuffix: u.streetNumberSuffix,
        block: u.block,
        staircase: u.staircase,
        floor: u.floor,
        door: u.door,
        postalCode: u.postalCode,
        municipality: u.municipality,
        province: u.province,
        builtAreaM2: u.builtAreaM2,
        participationQuota: u.participationQuota,
      })),
    });
  }

  // ── Catálogos para autocompletar la búsqueda por dirección ──────────────
  provinces(): Promise<CatastroProvince[]> {
    return this.api.get<CatastroProvince[]>('/catastro/provinces');
  }

  /** Solo los nombres de municipio. */
  municipalities(province: string, q: string): Promise<string[]> {
    return this.api.get<string[]>('/catastro/municipalities', { province, q });
  }

  streets(province: string, municipality: string, q: string): Promise<CatastroStreet[]> {
    return this.api.get<CatastroStreet[]>('/catastro/streets', { province, municipality, q });
  }
}
