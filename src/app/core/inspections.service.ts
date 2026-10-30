import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type { AssetOperationalStatus, EstateInstallations, InstallationInput } from './installations.models';
import { d } from './api-shared';
import {
  Asset, InspectionType, Inspection, InspectionResult, CorrectiveAction,
  InspectionStatus, InspectionOutcome, CorrectiveActionStatus,
} from './models';

const INSPECTION_STATUS_FROM_API: Record<string, InspectionStatus> = {
  planificada: 'Planificada', citada: 'Citada', realizada: 'Realizada',
  desfavorable: 'Desfavorable', vencida: 'Vencida', exenta: 'Exenta',
};
const INSPECTION_STATUS_TO_API: Record<string, string> = {
  'Planificada': 'planificada', 'Citada': 'citada', 'Realizada': 'realizada',
  'Desfavorable': 'desfavorable', 'Vencida': 'vencida', 'Exenta': 'exenta',
};
const INSPECTION_OUTCOME_FROM_API: Record<string, InspectionOutcome> = {
  favorable: 'Favorable', desfavorable: 'Desfavorable',
};
const INSPECTION_OUTCOME_TO_API: Record<string, string> = {
  'Favorable': 'favorable', 'Desfavorable': 'desfavorable',
};
const CORRECTIVE_ACTION_STATUS_FROM_API: Record<string, CorrectiveActionStatus> = {
  abierta: 'Abierta', en_progreso: 'En progreso', cerrada: 'Cerrada', vencida: 'Vencida',
};
const CORRECTIVE_ACTION_STATUS_TO_API: Record<string, string> = {
  'Abierta': 'abierta', 'En progreso': 'en_progreso', 'Cerrada': 'cerrada', 'Vencida': 'vencida',
};

function mapInspectionResult(r: any): InspectionResult {
  return {
    ...r,
    outcome: INSPECTION_OUTCOME_FROM_API[r.outcome] ?? r.outcome,
    date: d(r.date),
    cost: r.cost != null ? Number(r.cost) : null,
  };
}

function mapCorrectiveAction(a: any): CorrectiveAction {
  return {
    ...a,
    status: CORRECTIVE_ACTION_STATUS_FROM_API[a.status] ?? a.status,
    dueDate: a.dueDate ? d(a.dueDate) : a.dueDate,
  };
}

function mapInspection(i: any): Inspection {
  return {
    ...i,
    status: INSPECTION_STATUS_FROM_API[i.status] ?? i.status,
    nextDueDate: i.nextDueDate ? d(i.nextDueDate) : i.nextDueDate,
    appointmentDate: i.appointmentDate ? d(i.appointmentDate) : i.appointmentDate,
    lastDoneDate: i.lastDoneDate ? d(i.lastDoneDate) : i.lastDoneDate,
    results: (i.results ?? []).map(mapInspectionResult),
    correctiveActions: (i.correctiveActions ?? []).map(mapCorrectiveAction),
  };
}

/** Inspecciones normativas de elementos comunes (ascensores, PCI, eléctrica BT, RITE, legionela, gas, ITE/IEE...). */
@Injectable({ providedIn: 'root' })
export class InspectionsService {
  private api = inject(ApiClientService);

  async listAssetsByEstate(estateId: string): Promise<Asset[]> {
    return this.api.get<Asset[]>(`/estates/${estateId}/assets`);
  }

  async createAsset(estateId: string, input: {
    name: string; category: string; location?: string; manufacturer?: string; serialNumber?: string; notes?: string;
    operationalStatus?: AssetOperationalStatus; supplierId?: string;
  }): Promise<Asset> {
    return this.api.post<Asset>(`/estates/${estateId}/assets`, input);
  }

  /** Edición parcial de una instalación: lo que no se envía no cambia; `null` borra un campo opcional. */
  async updateAsset(estateId: string, assetId: string, patch: Partial<InstallationInput>): Promise<Asset> {
    return this.api.patch<Asset>(`/estates/${estateId}/assets/${assetId}`, patch);
  }

  /** Panel de Instalaciones: cada instalación con su estado derivado, revisiones, proveedor e incidencias, y el calendario. */
  async listInstallations(estateId: string): Promise<EstateInstallations> {
    return this.api.get<EstateInstallations>(`/estates/${estateId}/installations`);
  }

  async listInspectionTypes(estateId: string): Promise<InspectionType[]> {
    return this.api.get<InspectionType[]>(`/estates/${estateId}/inspection-types`);
  }

  async createInspectionType(estateId: string, input: {
    code: string; name: string; legalBasis?: string; requiresOca?: boolean;
  }): Promise<InspectionType> {
    return this.api.post<InspectionType>(`/estates/${estateId}/inspection-types`, input);
  }

  async listInspectionsByEstate(estateId: string, filters?: { status?: InspectionStatus; search?: string }): Promise<Inspection[]> {
    const raw = await this.api.get<any[]>(`/estates/${estateId}/inspections`, {
      status: filters?.status ? INSPECTION_STATUS_TO_API[filters.status] : undefined,
      search: filters?.search,
    });
    return raw.map(mapInspection);
  }

  async findInspectionById(id: string): Promise<Inspection | null> {
    const raw = await this.api.getOrNull<any>(`/inspections/${id}`);
    return raw ? mapInspection(raw) : null;
  }

  async createInspection(estateId: string, input: {
    assetId: string; inspectionTypeId: string; nextDueDate?: string; reminderDaysBefore?: number; notes?: string;
  }): Promise<Inspection> {
    const raw = await this.api.post<any>(`/estates/${estateId}/inspections`, input);
    return mapInspection(raw);
  }

  async updateInspection(id: string, patch: Partial<{
    status: InspectionStatus; nextDueDate: string; appointmentDate: string; lastDoneDate: string;
    reminderDaysBefore: number; notes: string;
  }>): Promise<Inspection> {
    const raw = await this.api.patch<any>(`/inspections/${id}`, {
      ...patch,
      status: patch.status ? INSPECTION_STATUS_TO_API[patch.status] : undefined,
    });
    return mapInspection(raw);
  }

  async deleteInspection(id: string): Promise<void> {
    await this.api.delete(`/inspections/${id}`);
  }

  /** `certificateFile` es opcional — se puede registrar un resultado sin certificado todavía. */
  async recordInspectionResult(
    inspectionId: string,
    input: { date: string; outcome: InspectionOutcome; defects?: string; cost?: number; notes?: string },
    certificateFile?: File,
  ): Promise<InspectionResult> {
    const formData = new FormData();
    if (certificateFile) formData.append('file', certificateFile, certificateFile.name);
    formData.append('date', input.date);
    formData.append('outcome', INSPECTION_OUTCOME_TO_API[input.outcome] ?? input.outcome);
    if (input.defects) formData.append('defects', input.defects);
    if (input.cost != null) formData.append('cost', String(input.cost));
    if (input.notes) formData.append('notes', input.notes);
    const raw = await this.api.post<any>(`/inspections/${inspectionId}/results`, formData);
    return mapInspectionResult(raw);
  }

  downloadInspectionCertificate(inspectionId: string, resultId: string): Promise<Blob> {
    return this.api.getBlob(`/inspections/${inspectionId}/results/${resultId}/certificate`);
  }

  async createCorrectiveAction(inspectionId: string, input: {
    title: string; description?: string; priority?: number; dueDate?: string; assigneeUserId?: string; supplierId?: string;
  }): Promise<CorrectiveAction> {
    const raw = await this.api.post<any>(`/inspections/${inspectionId}/corrective-actions`, input);
    return mapCorrectiveAction(raw);
  }

  async updateCorrectiveAction(actionId: string, patch: Partial<{
    title: string; description: string; priority: number; dueDate: string;
    status: CorrectiveActionStatus; assigneeUserId: string; supplierId: string;
  }>): Promise<CorrectiveAction> {
    const raw = await this.api.patch<any>(`/inspections/corrective-actions/${actionId}`, {
      ...patch,
      status: patch.status ? CORRECTIVE_ACTION_STATUS_TO_API[patch.status] : undefined,
    });
    return mapCorrectiveAction(raw);
  }
}
