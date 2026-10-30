import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { LateInterestAccrueResult, LateInterestPreview, LatePaymentInterestPolicy } from './models';

function mapPreview(x: any): LateInterestPreview {
  return { ...x, segments: x.segments.map((s: any) => ({ ...s })) };
}

function mapPolicy(x: any): LatePaymentInterestPolicy {
  return { ...x, annualRatePct: Number(x.annualRatePct) };
}

/** Intereses de demora (fase 10): liquidación bajo demanda, nunca con un cron. */
@Injectable({ providedIn: 'root' })
export class LateInterestService {
  private api = inject(ApiClientService);

  async listPolicies(estateId: string): Promise<LatePaymentInterestPolicy[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/late-interest-policies`);
    return rows.map(mapPolicy);
  }

  async createPolicy(estateId: string, payload: {
    annualRatePct: number;
    graceDays?: number;
    validFrom: string;
    meetingReference?: string;
  }): Promise<LatePaymentInterestPolicy> {
    return mapPolicy(await this.api.post<any>(`/estates/${estateId}/late-interest-policies`, payload));
  }

  async closePolicy(estateId: string, id: string, validTo: string): Promise<LatePaymentInterestPolicy> {
    return mapPolicy(await this.api.patch<any>(`/estates/${estateId}/late-interest-policies/${id}`, { validTo }));
  }

  /** No persiste nada: solo calcula. */
  async preview(estateId: string, receiptId: string, asOfDate?: string): Promise<LateInterestPreview> {
    return mapPreview(await this.api.post<any>(`/estates/${estateId}/late-interest/preview`, { receiptId, asOfDate }));
  }

  /** Contabiliza el recibo de intereses. */
  async accrue(estateId: string, receiptId: string, asOfDate?: string): Promise<LateInterestAccrueResult> {
    return mapPreview(await this.api.post<any>(`/estates/${estateId}/late-interest/accrue`, { receiptId, asOfDate })) as LateInterestAccrueResult;
  }
}
