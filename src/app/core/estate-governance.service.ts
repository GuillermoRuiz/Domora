import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';

export type OfficeRole = 'PRESIDENT' | 'VICE_PRESIDENT' | 'SECRETARY';
export type AppointableOfficeRole = 'PRESIDENT' | 'VICE_PRESIDENT';

export interface EstateOfficeTerm {
  id: string; estateId: string; role: OfficeRole;
  propertyId: string | null; userId: string | null; externalOwnerId: string | null;
  holderNameSnapshot: string; startsAt: string; endsAt: string | null;
  createdAt?: string;
  propertyReference?: string | null;
}
export interface OfficeHolder {
  userId: string | null; externalOwnerId: string | null; name: string;
  /** Marked as a key contact of the estate (shown in «Datos generales»). */
  keyContact?: boolean;
}
export interface OfficeProperty { id: string; ref: string | null; holders: OfficeHolder[]; }
export interface AppointOfficeTerm {
  role?: AppointableOfficeRole;
  startsAt: string; endsAt?: string; propertyId?: string;
  userId?: string; externalOwnerId?: string; holderNameSnapshot?: string;
}

/** An office in force on a given day, with its display label («Vicepresidente 2º»). */
export interface CurrentOffice { term: EstateOfficeTerm; label: string; }
export interface CurrentOffices { president: CurrentOffice | null; vicePresidents: CurrentOffice[]; }

/** Local calendar day as YYYY-MM-DD (not UTC: near midnight they differ). */
export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function inForce(term: EstateOfficeTerm, day: string): boolean {
  return term.startsAt.slice(0, 10) <= day && (!term.endsAt || term.endsAt.slice(0, 10) > day);
}

/** Vice-presidents rank by appointment order (LPH art. 13.4): when one leaves, the rest move up. */
export function currentOffices(terms: EstateOfficeTerm[], day: string): CurrentOffices {
  const live = terms.filter(term => inForce(term, day));
  const president = live.find(term => term.role === 'PRESIDENT');
  const vicePresidents = live
    .filter(term => term.role === 'VICE_PRESIDENT')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    .map((term, index) => ({ term, label: `Vicepresidente ${index + 1}º` }));
  return { president: president ? { term: president, label: 'Presidente' } : null, vicePresidents };
}

export function sameHolder(term: EstateOfficeTerm, holder: OfficeHolder): boolean {
  return (!!holder.userId && term.userId === holder.userId) || (!!holder.externalOwnerId && term.externalOwnerId === holder.externalOwnerId);
}

@Injectable({ providedIn: 'root' })
export class EstateGovernanceService {
  private readonly api = inject(ApiClientService);
  list(estateId: string) { return this.api.get<EstateOfficeTerm[]>(`/estates/${estateId}/office-terms`); }
  candidates(estateId: string) { return this.api.get<OfficeProperty[]>(`/estates/${estateId}/office-terms/candidates`); }
  appoint(estateId: string, dto: AppointOfficeTerm) { return this.api.post<EstateOfficeTerm>(`/estates/${estateId}/office-terms`, dto); }
  end(estateId: string, termId: string, endsAt: string) { return this.api.patch<EstateOfficeTerm>(`/estates/${estateId}/office-terms/${termId}/end`, { endsAt }); }
}
