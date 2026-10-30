import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d, PAY_METHOD_TO_API } from './api-shared';

export type TaxModel = '111' | '190' | '347';

export interface EstateTaxHeader {
  name: string;
  cif: string | null;
  address: string;
  location: string;
}

export interface Model111 {
  estate: EstateTaxHeader;
  year: number;
  quarter: number;
  period: string;
  from: string;
  to: string;
  deadline: string;
  /** Casillas 01-03 (trabajo), 07-09 (actividades) y 28 (total). */
  boxes: Record<'01' | '02' | '03' | '07' | '08' | '09' | '28', number>;
  unclassified: { recipients: number; perceptions: number; withholdings: number };
  settlements: { id: string; date: string; amount: number; reference: string | null }[];
  settled: number;
  pending: number;
  detail: {
    date: string; key: 'A' | 'G' | 'other'; nif: string | null; name: string; documentRef: string;
    source: 'payroll' | 'supplier_payment'; perception: number; withholding: number;
  }[];
}

export interface Model190 {
  estate: EstateTaxHeader;
  year: number;
  rows: { nif: string | null; name: string; key: 'A' | 'G' | 'other'; subkey: string | null; perceptions: number; withholdings: number }[];
  totals: { recipients: number; perceptions: number; withholdings: number };
  missingNif: string[];
}

export interface Model347 {
  estate: EstateTaxHeader;
  year: number;
  purchases: { supplierId: string; name: string; nif: string | null; total: number; quarters: number[] }[];
  excluded: { supplierId: string; name: string; total: number; reason: 'art_33_5' | 'retencion' | 'umbral' }[];
  income: { name: string; nif: string | null; total: number; quarters: number[] }[];
  missingNif: string[];
}

export type TaxSettlementKind = 'modelo111' | 'seguridad_social';

export interface TaxSettlement {
  id: string;
  kind: TaxSettlementKind;
  period: string;
  date: string;
  amount: number;
  reference: string | null;
  bankAccountAlias: string | null;
  entryNumber: number;
  status: 'Vigente' | 'Deshecho';
  undoReason: string | null;
}

/** Modelos fiscales y pagos a Hacienda y a la Seguridad Social de una finca. */
@Injectable({ providedIn: 'root' })
export class TaxService {
  private api = inject(ApiClientService);

  model111(estateId: string, year: number, quarter: number): Promise<Model111> {
    return this.api.get<Model111>(`/estates/${estateId}/tax/111`, { year, quarter });
  }

  model190(estateId: string, year: number): Promise<Model190> {
    return this.api.get<Model190>(`/estates/${estateId}/tax/190`, { year });
  }

  model347(estateId: string, year: number): Promise<Model347> {
    return this.api.get<Model347>(`/estates/${estateId}/tax/347`, { year });
  }

  /** El mismo modelo en Excel o PDF, para descargar. */
  download(estateId: string, model: TaxModel, format: 'xlsx' | 'pdf', year: number, quarter?: number): Promise<Blob> {
    const params = new URLSearchParams({ year: String(year), format });
    if (quarter) params.set('quarter', String(quarter));
    return this.api.getBlob(`/estates/${estateId}/tax/${model}?${params.toString()}`);
  }

  async listSettlements(estateId: string, year?: number): Promise<TaxSettlement[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/tax-settlements`, { year });
    return rows.map((t) => ({ ...t, date: d(t.date), amount: Number(t.amount) }));
  }

  /** Registra el ingreso del 111 (periodo AAAA-Tn) o el pago de la Seguridad Social (AAAA-MM). */
  async createSettlement(estateId: string, payload: {
    kind: TaxSettlementKind; period: string; date: string; amount: number; bankAccountId?: string; reference?: string;
  }): Promise<void> {
    await this.api.post(`/estates/${estateId}/tax-settlements`, payload);
  }

  async undoSettlement(id: string, reason: string): Promise<void> {
    await this.api.post(`/tax-settlements/${id}/undo`, { reason });
  }
}

export type PayrollKind = 'mensual' | 'extra' | 'finiquito' | 'otros';

export interface PayrollRecord {
  id: string;
  staffMemberId: string;
  staffName: string;
  staffNationalId: string | null;
  position: string;
  period: string;
  kind: PayrollKind;
  accrualDate: string;
  grossSalary: number;
  employeeSs: number;
  employerSs: number;
  irpfWithholding: number;
  netPay: number;
  totalCost: number;
  status: 'Registrada' | 'Pagada' | 'Anulada';
  paidDate: string | null;
  cancelReason: string | null;
  notes: string | null;
}

function mapPayroll(p: any): PayrollRecord {
  return { ...p, accrualDate: d(p.accrualDate), paidDate: p.paidDate ? d(p.paidDate) : null };
}

/** Nóminas registradas a mano: los importes vienen de la gestoría laboral. */
@Injectable({ providedIn: 'root' })
export class PayrollService {
  private api = inject(ApiClientService);

  async list(estateId: string, year?: number): Promise<PayrollRecord[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/payroll`, { year });
    return rows.map(mapPayroll);
  }

  async create(estateId: string, payload: {
    staffMemberId: string; period: string; kind?: PayrollKind; accrualDate?: string;
    grossSalary: number; employeeSs: number; employerSs: number; irpfWithholding: number; notes?: string;
  }): Promise<PayrollRecord> {
    return mapPayroll(await this.api.post<any>(`/estates/${estateId}/payroll`, payload));
  }

  async pay(id: string, payload: { date: string; method: string; bankAccountId?: string }): Promise<PayrollRecord> {
    return mapPayroll(await this.api.post<any>(`/payroll/${id}/pay`, {
      ...payload,
      method: PAY_METHOD_TO_API[payload.method] ?? payload.method,
    }));
  }

  async undoPayment(id: string, reason: string): Promise<PayrollRecord> {
    return mapPayroll(await this.api.post<any>(`/payroll/${id}/undo-payment`, { reason }));
  }

  async cancel(id: string, reason: string): Promise<PayrollRecord> {
    return mapPayroll(await this.api.post<any>(`/payroll/${id}/cancel`, { reason }));
  }
}
