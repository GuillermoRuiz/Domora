import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { ClaimStatus, InsuranceClaimView } from './insurance-claims.models';

/** Cambios que admite `PATCH /issues/:id/insurance-claims/:claimId` (correcciones y estado, sin comunicación). */
export interface UpdateInsuranceClaimBody {
  status?: ClaimStatus;
  reference?: string;
  contactName?: string;
  contactPhone?: string;
  policyNumber?: string;
}

/**
 * Siniestros de seguro de una incidencia. Abrir un
 * siniestro o dar su referencia se hace al «Registrar gestión» (`POST /issues/:id/interactions`); aquí solo se lee y se
 * cambia el estado desde el propio bloque «Seguro».
 */
@Injectable({ providedIn: 'root' })
export class InsuranceClaimsService {
  private readonly api = inject(ApiClientService);

  list(issueId: string): Promise<InsuranceClaimView[]> {
    return this.api.get<InsuranceClaimView[]>(`/issues/${issueId}/insurance-claims`);
  }

  update(issueId: string, claimId: string, body: UpdateInsuranceClaimBody): Promise<InsuranceClaimView> {
    return this.api.patch<InsuranceClaimView>(`/issues/${issueId}/insurance-claims/${claimId}`, body);
  }
}
