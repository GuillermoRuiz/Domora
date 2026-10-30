import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import type { EssentialDocumentType } from './essential-documents';

export interface GeneralOffice { label: string; name: string; propertyRef: string | null; since: string }
export interface GeneralKeyContact { name: string; office: string | null; propertyRefs: string[]; phone: string | null; email: string | null }
export interface GeneralInsurance {
  contractId: string; type: string; insurer: string; contractNumber: string | null;
  endDate: string | null; renewalType: 'manual' | 'tacita'; coverage: string | null;
}

/** `GET estates/:id/general-overview`: what the read-only «Datos generales» tab shows beyond the estate row. */
export interface EstateGeneralOverview {
  properties: number;
  coefficients: { total: number; informed: number; missing: number; max: { ref: string; value: number } | null; min: { ref: string; value: number } | null };
  surface: { parcelAreaM2: number | null; builtAreaM2: number | null; builtAreaInformed: number };
  fiscalYear: { year: number; startsOn: string; endsOn: string; status: string };
  bank: { bankName: string | null; iban: string; masked: boolean; accountCode: string | null; alias: string | null } | null;
  administrator: { name: string; contactName: string | null; phone: string | null; email: string | null } | null;
  offices: { president: GeneralOffice | null; vicePresidents: GeneralOffice[] };
  keyContacts: GeneralKeyContact[];
  essentialDocuments: { type: EssentialDocumentType; document: { id: string; title: string; date: string | null; size: string | null } | null }[];
  insurance: GeneralInsurance[];
}

export interface SetKeyContact { propertyId: string; userId?: string; externalOwnerId?: string; keyContact: boolean }

@Injectable({ providedIn: 'root' })
export class EstateGeneralService {
  private readonly api = inject(ApiClientService);
  overview(estateId: string) { return this.api.get<EstateGeneralOverview>(`/estates/${estateId}/general-overview`); }
  setKeyContact(estateId: string, body: SetKeyContact) { return this.api.put<unknown>(`/estates/${estateId}/key-contacts`, body); }
}
