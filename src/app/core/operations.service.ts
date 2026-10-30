import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type { AgendaItem } from './models';
import type { IssueSituationView } from './issue-workflow.models';

export type OperationsKind = 'meetings' | 'issues';
export interface OperationEstate {
  id: string;
  name: string;
  address?: string;
  streetNumber?: string;
  location?: string;
}
export interface OperationQuery {
  estateId?: string;
  search: string;
  filter: string;
  sort: string;
  page: number;
  pageSize: number;
  /** Solo Incidencias: situación exacta, quién tiene la pelota, estado del expediente y antigüedad. */
  situation?: string;
  ball?: string;
  status?: string;
  created?: string;
  /** Solo las incidencias de esta instalación. */
  assetId?: string;
}
export interface OperationRow {
  id: string;
  estate: OperationEstate;
  title: string;
  date: string;
  status: string;
  statusLabel: string;
  tone: string;
  typeLabel: string;
  description: string;
  ref: string;
  priority: string;
  responsible: string;
  location: string;
  agenda: AgendaItem[];
  includeJitsi: boolean;
  actaSignedAt: string | null;
  attachments: number;
  thumbnail: string | null;
  /** Solo Incidencias: situación, siguiente paso y quién tiene la pelota (proyección del servidor). */
  situation: IssueSituationView | null;
}
export interface OperationPage {
  items: OperationRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: Record<string, number>;
  /** Solo Incidencias: la instalación por la que se filtra, si la hay. */
  asset?: { id: string; name: string } | null;
}
/** Contrato ligero de `GET /operations/issues`; el detalle usa su propio endpoint. */
export interface IssueListItemDto {
  id: string;
  title: string;
  status: string;
  date: string;
  estate: Pick<OperationEstate, 'id' | 'name'>;
  description: string;
  ref: string;
  situationView: IssueSituationView | null;
}

interface MeetingListItemDto {
  id: string;
  estateId?: string;
  title: string;
  status: string;
  type: string;
  scheduledAt1: string;
  estate?: OperationEstate;
  location?: string | null;
  agenda?: AgendaItem[];
  includeJitsi?: boolean;
  actaSignedAt?: string | null;
}
const STATUS: Record<string, [string, string]> = {
  convocada: ['Convocada', 'blue'],
  celebrada: ['Celebrada', 'gold'],
  firmada: ['Firmada', 'green'],
  cancelada: ['Cancelada', 'muted'],
  Abierta: ['Abierta', 'gold'],
  EnReparacion: ['En reparación', 'blue'],
  PendienteProveedor: ['Pendiente de proveedor', 'gold'],
  PendienteInformacion: ['Pendiente de información', 'purple'],
  Resuelta: ['Resuelta', 'green'],
  Cerrada: ['Cerrada', 'muted'],
  Retirada: ['Retirada', 'muted'],
};
const TYPE: Record<string, string> = {
  ordinaria: 'Ordinaria',
  extraordinaria: 'Extraordinaria',
  Averia: 'Avería',
  DanoEstructural: 'Daño estructural',
};

@Injectable({ providedIn: 'root' })
export class OperationsService {
  private readonly api = inject(ApiClientService);
  async list(
    kind: OperationsKind,
    query: OperationQuery,
    options?: { signal?: AbortSignal },
  ): Promise<OperationPage> {
    if (kind === 'issues') {
      const response = await this.api.get<
        Omit<OperationPage, 'items'> & { items: IssueListItemDto[] }
      >('/operations/issues', { ...query }, options);
      return { ...response, items: response.items.map(mapIssueRow) };
    }
    const response = await this.api.get<
      Omit<OperationPage, 'items'> & { items: MeetingListItemDto[] }
    >('/operations/meetings', { ...query }, options);
    return { ...response, items: response.items.map(mapMeetingRow) };
  }
  async meeting(id: string): Promise<OperationRow> {
    const row = await this.api.get<MeetingListItemDto>(`/meetings/${id}`);
    const estate = await this.api.get<OperationEstate>(
      `/estates/${row.estateId}`,
    );
    return mapMeetingRow({ ...row, estate });
  }
}

function rowStatus(status: string): [string, string] {
  return STATUS[status] ?? [status, 'muted'];
}

function mapIssueRow(row: IssueListItemDto): OperationRow {
  const [statusLabel, tone] = rowStatus(row.status);
  return {
    id: row.id,
    estate: row.estate,
    title: row.title,
    date: row.date,
    status: row.status,
    statusLabel,
    tone,
    typeLabel: '',
    description: row.description,
    ref: row.ref,
    priority: '',
    responsible: '',
    location: '',
    agenda: [],
    includeJitsi: false,
    actaSignedAt: null,
    attachments: 0,
    thumbnail: null,
    situation: row.situationView ?? null,
  };
}

function mapMeetingRow(row: MeetingListItemDto): OperationRow {
  const [statusLabel, tone] = rowStatus(row.status);
  return {
    id: row.id,
    estate: row.estate!,
    title: row.title,
    date: row.scheduledAt1,
    status: row.status,
    statusLabel,
    tone,
    typeLabel: TYPE[row.type] ?? row.type,
    description: '',
    ref: '',
    priority: '',
    responsible: '',
    location: row.location ?? '',
    agenda: row.agenda ?? [],
    includeJitsi: row.includeJitsi ?? false,
    actaSignedAt: row.actaSignedAt ?? null,
    attachments: 0,
    thumbnail: null,
    situation: null,
  };
}
