import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import {
  ImportBatch, ImportSourcePlatform, ImportScope, ImportEntityType,
  ColumnPreset, ImportValidationSummary, ImportCommitSummary,
} from './models';

/** Migración autoservicio desde Gesfincas/genérico (rol B) — mismo nombre que el módulo del backend para este feature. */
/** Qué deshizo el backend. Los asientos importados no se borran: se revierten con un contraasiento. */
export interface ImportRollbackResult {
  removedProperties: number;
  removedOwners: number;
  reversedEntries: number;
  removedReceipts: number;
  removedRemesas: number;
  removedRemesaLines: number;
}

@Injectable({ providedIn: 'root' })
export class ImportsService {
  private api = inject(ApiClientService);

  listImportBatches(estateId: string): Promise<ImportBatch[]> {
    return this.api.get<ImportBatch[]>(`/estates/${estateId}/imports`);
  }

  getImportBatch(estateId: string, id: string): Promise<ImportBatch> {
    return this.api.get<ImportBatch>(`/estates/${estateId}/imports/${id}`);
  }

  /** `headers` (si se pasa) sirve para que el backend devuelva `suggestedMapping` — nunca fija la columna a ciegas, solo prerellena el `<select>`. */
  getImportPresets(
    estateId: string,
    platform: ImportSourcePlatform,
    entityType: ImportEntityType,
    headers?: string[],
  ): Promise<{ fields: ColumnPreset[]; suggestedMapping: Record<string, string> }> {
    return this.api.get(`/estates/${estateId}/imports/presets`, {
      platform,
      entityType,
      headers: headers && headers.length > 0 ? headers.join(',') : undefined,
    });
  }

  createImportBatch(
    estateId: string,
    file: File,
    sourcePlatform: ImportSourcePlatform,
    scope: ImportScope,
  ): Promise<ImportBatch> {
    return this.api.uploadFile<ImportBatch>(`/estates/${estateId}/imports`, file, {
      sourcePlatform,
      scope,
    });
  }

  parseImportBatch(estateId: string, id: string): Promise<{ headers: string[]; sampleRows: Record<string, string>[]; totalRows: number }> {
    return this.api.post(`/estates/${estateId}/imports/${id}/parse`, {});
  }

  validateImportMapping(
    estateId: string,
    id: string,
    entityType: ImportEntityType,
    mapping: Record<string, string>,
  ): Promise<{ summary: ImportValidationSummary }> {
    return this.api.post(`/estates/${estateId}/imports/${id}/validate`, { entityType, mapping });
  }

  commitImportBatch(estateId: string, id: string): Promise<ImportCommitSummary> {
    return this.api.post(`/estates/${estateId}/imports/${id}/commit`, {});
  }

  rollbackImportBatch(estateId: string, id: string): Promise<ImportRollbackResult> {
    return this.api.post(`/estates/${estateId}/imports/${id}/rollback`, {});
  }
}
