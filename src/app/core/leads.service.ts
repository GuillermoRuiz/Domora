import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d } from './api-shared';
import type {
  ClientCommercialRow,
  ClientsOverview,
  CommercialFollowUp,
  ConvertLeadInput,
  Lead,
  LeadDetail,
  LeadInput,
} from './models';

const dayOrNull = (v: string | null | undefined): string | null => (v ? d(v) : null);

function mapLead(raw: any): Lead {
  return {
    id: raw.id,
    name: raw.name,
    contactName: raw.contactName ?? null,
    contactEmail: raw.contactEmail ?? null,
    contactPhone: raw.contactPhone ?? null,
    city: raw.city ?? null,
    origin: raw.origin,
    planOfInterest: raw.planOfInterest ?? null,
    status: raw.status,
    nextAction: raw.nextAction ?? null,
    nextActionAt: dayOrNull(raw.nextActionAt),
    notes: raw.notes ?? null,
    convertedAdministratorId: raw.convertedAdministratorId ?? null,
    convertedAt: dayOrNull(raw.convertedAt),
    createdAt: d(raw.createdAt),
    onboardingRequest: raw.onboardingRequest ?? null,
    convertedAdministrator: raw.convertedAdministrator ?? null,
    followUpCount: Number(raw.followUpCount ?? 0),
    lastFollowUpAt: dayOrNull(raw.lastFollowUpAt),
  };
}

function mapFollowUp(raw: any): CommercialFollowUp {
  return { id: raw.id, occurredAt: d(raw.occurredAt), text: raw.text, author: raw.author };
}

function mapClientRow(raw: any): ClientCommercialRow {
  return {
    administratorId: raw.administratorId,
    signupAt: d(raw.signupAt),
    nextRenewal: raw.nextRenewal ? { date: d(raw.nextRenewal.date), amount: Number(raw.nextRenewal.amount) } : null,
    lastActiveDay: dayOrNull(raw.lastActiveDay),
    nextAction: raw.nextAction ?? null,
    nextActionAt: dayOrNull(raw.nextActionAt),
  };
}

/**
 * Clientes (odd/tasks/role-a-panel.md S13), role A: potential clients (leads)
 * with their «seguimiento comercial» and conversion, plus the commercial data
 * of the despacho clients that `GET /admins` does not carry.
 */
@Injectable({ providedIn: 'root' })
export class LeadsService {
  private api = inject(ApiClientService);

  async listLeads(): Promise<Lead[]> {
    return (await this.api.get<any[]>('/leads')).map(mapLead);
  }

  async getLead(id: string): Promise<LeadDetail> {
    const raw = await this.api.get<any>(`/leads/${id}`);
    return { ...mapLead(raw), followUps: (raw.followUps ?? []).map(mapFollowUp) };
  }

  async createLead(input: LeadInput & { name: string; origin: NonNullable<LeadInput['origin']> }): Promise<Lead> {
    return mapLead(await this.api.post<any>('/leads', input));
  }

  async updateLead(id: string, input: LeadInput): Promise<Lead> {
    return mapLead(await this.api.patch<any>(`/leads/${id}`, input));
  }

  async addLeadFollowUp(id: string, text: string): Promise<CommercialFollowUp> {
    return mapFollowUp(await this.api.post<any>(`/leads/${id}/follow-ups`, { text }));
  }

  /** «Convertir en cliente»: the API creates the despacho (same record as Administradores de fincas). */
  async convertLead(id: string, input: ConvertLeadInput): Promise<{ administratorId: string }> {
    const raw = await this.api.post<any>(`/leads/${id}/convert`, input);
    return { administratorId: raw.administratorId };
  }

  async clientsOverview(): Promise<ClientsOverview> {
    const raw = await this.api.get<any>('/clients/overview');
    const k = raw.kpis ?? {};
    return {
      kpis: {
        activeClients: Number(k.activeClients ?? 0),
        inTrial: Number(k.inTrial ?? 0),
        renewals: {
          count: Number(k.renewals?.count ?? 0),
          amount: Number(k.renewals?.amount ?? 0),
          windowDays: Number(k.renewals?.windowDays ?? 90),
        },
        churnRisk: Number(k.churnRisk ?? 0),
      },
      clients: (raw.clients ?? []).map(mapClientRow),
    };
  }

  async setClientNextAction(administratorId: string, input: { nextAction: string | null; nextActionAt: string | null }): Promise<void> {
    await this.api.put(`/clients/${administratorId}/next-action`, input);
  }

  async clientFollowUps(administratorId: string): Promise<CommercialFollowUp[]> {
    return (await this.api.get<any[]>(`/clients/${administratorId}/follow-ups`)).map(mapFollowUp);
  }

  async addClientFollowUp(administratorId: string, text: string): Promise<CommercialFollowUp> {
    return mapFollowUp(await this.api.post<any>(`/clients/${administratorId}/follow-ups`, { text }));
  }
}
