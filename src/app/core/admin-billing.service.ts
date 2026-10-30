import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type { AdminPayMethod, AdminSepaMandate, OwnBilling, OwnBillingUpdate } from './models';

const TO_API: Record<AdminPayMethod, string> = { 'Domiciliación': 'Domiciliacion', Tarjeta: 'Tarjeta', Transferencia: 'Transferencia' };
const FROM_API: Record<string, AdminPayMethod> = { Domiciliacion: 'Domiciliación', Tarjeta: 'Tarjeta', Transferencia: 'Transferencia' };

function fromApi(raw: OwnBilling): OwnBilling {
  return raw.billing
    ? { ...raw, billing: { ...raw.billing, paymentMethod: FROM_API[raw.billing.paymentMethod] ?? raw.billing.paymentMethod } }
    : raw;
}

/**
 * Billing data of the despacho edited by the despacho itself (role B) and its
 * SEPA mandate (odd/tasks/role-a-panel.md S17). The despacho always comes from
 * the token: no id is ever sent.
 */
@Injectable({ providedIn: 'root' })
export class AdminBillingService {
  private api = inject(ApiClientService);

  async getOwn(): Promise<OwnBilling> {
    return fromApi(await this.api.get<OwnBilling>('/admin-billing/me'));
  }

  async updateOwn(update: OwnBillingUpdate): Promise<OwnBilling> {
    const raw = await this.api.put<OwnBilling>('/admin-billing/me', { ...update, paymentMethod: TO_API[update.paymentMethod] });
    return fromApi(raw);
  }

  /** Role A: the SEPA mandates of one despacho, newest first, masked. */
  listMandates(administratorId: string): Promise<AdminSepaMandate[]> {
    return this.api.get<AdminSepaMandate[]>(`/admin-billing/${administratorId}/sepa-mandates`);
  }
}
