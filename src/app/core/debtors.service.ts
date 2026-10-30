import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { d, PAY_METHOD_TO_API } from './api-shared';
import { DebtCertificate, Debtor, DebtorAction, GestionType, NeighbourBalance, PaymentAgreement, PaymentAgreementInstallment } from './models';

const GESTION_TYPE_FROM_API: Record<string, GestionType> = {
  Llamada: 'Llamada', Email: 'Email', CartaAmistosa: 'Carta amistosa',
  CartaFormal: 'Carta formal', Burofax: 'Burofax', AccionJudicial: 'Acción judicial',
};
const GESTION_TYPE_TO_API: Record<string, string> = {
  'Llamada': 'Llamada', 'Email': 'Email', 'Carta amistosa': 'CartaAmistosa',
  'Carta formal': 'CartaFormal', 'Burofax': 'Burofax', 'Acción judicial': 'AccionJudicial',
};

function mapDebtorAction(a: any): DebtorAction {
  return { ...a, type: GESTION_TYPE_FROM_API[a.type] ?? a.type, date: d(a.date) };
}

/** Ref/escalera/piso/puerta formateados en una etiqueta legible — mismo criterio que usa el backend para el nombre del fichero .xlsx. */
function formatPropertyLabel(p: { ref?: string | null; staircase?: string | null; floor?: string | null; door?: string | null } | null | undefined): string {
  if (!p) return '—';
  const parts = [p.ref, p.staircase && `esc. ${p.staircase}`, p.floor && `${p.floor}º`, p.door].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}

/** `Debtor` no tiene columna `name` en backend — el titular llega en `titular`, resuelto vía PropertyMembership. */
function mapDebtor(x: any): Debtor {
  return {
    ...x,
    name: x.titular ?? 'Sin titular',
    property: formatPropertyLabel(x.property),
    amount: Number(x.amount),
    interest: Number(x.interest),
    oldest: d(x.oldest),
    lastContact: x.lastContact ? d(x.lastContact) : null,
    reminders: { l1: !!x.reminderL1, l2: !!x.reminderL2, bf: !!x.reminderBf },
  };
}

function mapDebtCertificate(x: any): DebtCertificate {
  return {
    ...x,
    pendingReceipts: (x.pendingReceipts ?? []).map((r: any) => ({
      ...r,
      amount: Number(r.amount),
      outstanding: Number(r.outstanding),
    })),
    principal: Number(x.principal),
    interest: Number(x.interest),
    totalDebt: Number(x.totalDebt),
    activeAgreement: x.activeAgreement
      ? { ...x.activeAgreement, totalAmount: Number(x.activeAgreement.totalAmount), downPaymentAmount: Number(x.activeAgreement.downPaymentAmount) }
      : null,
  };
}

function mapBalance(x: any): NeighbourBalance {
  return {
    ...x,
    balance: Number(x.balance),
    advance: Number(x.advance ?? 0),
    lastContact: x.lastContact ? d(x.lastContact) : null,
  };
}

/** Morosidad: deudores, gestiones de cobro registradas, y acuerdos de pago fraccionado. */
@Injectable({ providedIn: 'root' })
export class DebtorsService {
  private api = inject(ApiClientService);

  // ── Debtors ──────────────────────────────────────────────────────────────
  async listDebtors(): Promise<Debtor[]> {
    const debtors = await this.api.get<any[]>('/debtors');
    return debtors.map(mapDebtor);
  }

  async listDebtorsByEstate(estateId: string): Promise<Debtor[]> {
    const debtors = await this.api.get<any[]>(`/estates/${estateId}/debtors`);
    return debtors.map(mapDebtor);
  }

  /** Saldo de TODOS los vecinos de la finca (recalculado en vivo), no solo quien ya tiene fila en Debtor — ver DebtorsService.computeBalances en backend. */
  async listBalancesByEstate(estateId: string): Promise<NeighbourBalance[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/debtors/balances`);
    return rows.map(mapBalance);
  }

  /** `.xlsx` real generado en backend — nunca CSV disfrazado. */
  downloadBalancesExcel(estateId: string): Promise<Blob> {
    return this.api.getBlob(`/estates/${estateId}/debtors/balances.xlsx`);
  }

  /** Certificado de deuda (art. 9.1.e LPH) — también sirve para saber qué recibos de una propiedad tienen deuda pendiente. */
  async getDebtCertificate(propertyId: string): Promise<DebtCertificate> {
    return mapDebtCertificate(await this.api.get<any>(`/properties/${propertyId}/debt-certificate`));
  }

  /** PDF en borrador del certificado, con firmas en blanco — a diferencia del JSON de arriba, también lo puede pedir el propio rol C. */
  downloadDebtCertificatePdf(propertyId: string): Promise<Blob> {
    return this.api.getBlob(`/properties/${propertyId}/debt-certificate.pdf`);
  }

  // ── Debtor actions ───────────────────────────────────────────────────────
  async listActionsForDebtor(debtorId: string): Promise<DebtorAction[]> {
    const actions = await this.api.get<any[]>(`/debtors/${debtorId}/actions`);
    return actions.map(mapDebtorAction);
  }

  async addDebtorAction(action: Omit<DebtorAction, 'id'>): Promise<DebtorAction> {
    const created = await this.api.post<any>(`/debtors/${action.debtorId}/actions`, {
      type: GESTION_TYPE_TO_API[action.type] ?? action.type,
      date: action.date,
      note: action.note,
      result: action.result || undefined,
      onBehalfOfUserId: action.onBehalfOfUserId ?? undefined,
    });
    return mapDebtorAction(created);
  }

  // ── Payment agreements (acuerdos de pago) ───────────────────────────────
  async findActiveAgreementForDebtor(debtorId: string): Promise<PaymentAgreement | null> {
    const a = await this.api.getOrNull<any>(`/debtors/${debtorId}/agreement`);
    if (!a) return null;
    return { ...a, signedAt: d(a.signedAt), firstDueDate: d(a.firstDueDate) };
  }

  async listInstallmentsForAgreement(agreementId: string): Promise<PaymentAgreementInstallment[]> {
    const rows = await this.api.get<any[]>(`/payment-agreements/${agreementId}/installments`);
    return rows
      .map(i => ({ ...i, dueDate: d(i.dueDate), paidAt: i.paidAt ? d(i.paidAt) : i.paidAt }))
      .sort((a, b) => a.seq - b.seq);
  }

  async createPaymentAgreement(input: {
    debtorId: string;
    totalAmount: number;
    downPaymentAmount: number;
    installmentsCount: number;
    firstDueDate: string;
    createdByUserId?: string;
  }): Promise<PaymentAgreement> {
    const a = await this.api.post<any>(`/debtors/${input.debtorId}/agreement`, {
      totalAmount: input.totalAmount,
      downPaymentAmount: input.downPaymentAmount || undefined,
      installmentsCount: input.installmentsCount,
      firstDueDate: input.firstDueDate,
    });
    return { ...a, signedAt: d(a.signedAt), firstDueDate: d(a.firstDueDate) };
  }

  /**
   * Registra el pago de una cuota: el backend lo contabiliza como un cobro
   * imputado a los recibos que cubre el plan. Sin fecha, hoy.
   */
  async markInstallmentPaid(installmentId: string, opts: { date?: string; method?: string } = {}): Promise<void> {
    await this.api.patch(`/payment-installments/${installmentId}/paid`, {
      ...(opts.date ? { date: opts.date } : {}),
      ...(opts.method ? { method: PAY_METHOD_TO_API[opts.method] ?? opts.method } : {}),
    });
  }

  async cancelPaymentAgreement(agreementId: string, reason?: string): Promise<void> {
    await this.api.post(`/payment-agreements/${agreementId}/cancel`, { cancelledReason: reason });
  }
}
