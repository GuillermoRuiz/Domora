import { Injectable, inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ApiClientService } from './api-client.service';
import { CommunityScopeService } from './community-scope.service';
import { ReportCatalog, ReportEstate, ReportFormat, ReportInput, ReportResult } from './reporting.models';

@Injectable({ providedIn: 'root' })
export class ReportingService {
  private readonly api = inject(ApiClientService);
  private readonly communityScope = inject(CommunityScopeService);
  async catalog(): Promise<ReportCatalog> {
    const catalog = await this.api.get<ReportCatalog | []>('/reports/catalog');
    if (Array.isArray(catalog)) {
      if (catalog.length === 0) return { categories: [], reports: [] };
      throw new Error('Formato de catálogo no válido.');
    }
    return catalog;
  }
  async estates(): Promise<ReportEstate[]> {
    const estates = await this.api.get<ReportEstate[]>('/reports/estates');
    this.communityScope.remember(estates);
    return estates;
  }
  query(key: string, input: ReportInput): Promise<ReportResult> {
    return this.api.post(`/reports/${encodeURIComponent(key)}/query`, input);
  }
  export(key: string, input: ReportInput, format: ReportFormat, snapshotId?: string): Promise<Blob> {
    return this.api.postBlob(`/reports/${encodeURIComponent(key)}/export`, { ...input, format, ...(snapshotId !== undefined ? { snapshotId } : {}) });
  }
  async propertyOptions(estateId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.api.get<{ id: string; ref?: string; floor?: string; door?: string }[]>(`/estates/${encodeURIComponent(estateId)}/properties`);
    return rows.map(p => ({ id: p.id, name: p.ref || [p.floor, p.door].filter(Boolean).join(' ') || 'Propiedad sin referencia' }));
  }
  async supplierOptions(estateId: string): Promise<{ id: string; name: string }[]> {
    const rows = await this.api.get<{ id: string; name: string }[]>(`/estates/${encodeURIComponent(estateId)}/suppliers`);
    return rows.map(p => ({ id: p.id, name: p.name }));
  }
}

export function reportError(error: unknown, fallback = 'No se ha podido generar el informe. Vuelve a intentarlo.'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 403) return 'No tienes permiso para consultar este informe o alguna de las comunidades seleccionadas. Revisa tu selección.';
    if (error.status === 401) return 'Tu sesión ha caducado. Vuelve a iniciar sesión.';
    if (error.status === 404) return 'No se ha encontrado el informe o su configuración. Revisa la selección e inténtalo de nuevo.';
    if (error.status === 0) return 'No se ha podido conectar con el servidor. Comprueba tu conexión e inténtalo de nuevo.';
    if (error.status === 429) return 'Se han solicitado demasiados informes. Espera unos instantes e inténtalo de nuevo.';
    if (error.status === 400 || error.status === 422) {
      const messages: unknown = error.error?.message;
      if (Array.isArray(messages)) return messages.filter((m): m is string => typeof m === 'string').join(' ');
      if (typeof messages === 'string') return messages;
    }
  }
  return fallback;
}
