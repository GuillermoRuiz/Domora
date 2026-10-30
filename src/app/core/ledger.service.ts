import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import {
  AccountingSettings, BankAccount, ReserveAllocationRule, ReserveMode,
  OpeningBalancesView, OpeningValidateResult, SaveOpeningDraftPayload,
  OpeningDifferenceRole,
} from './models';

/**
 * Configuración de la contabilidad de una finca: fecha de inicio contable y
 * cuentas bancarias. El plan de cuentas sigue en AccountingService (con su
 * caché por finca).
 */
@Injectable({ providedIn: 'root' })
export class LedgerService {
  private api = inject(ApiClientService);

  // El saldo llega como Decimal en string (preserva precisión): se pasa a número.
  private mapBank(raw: any): BankAccount {
    return { ...raw, balance: Number(raw.balance) };
  }

  async listBankAccounts(estateId: string): Promise<BankAccount[]> {
    const rows = await this.api.get<any[]>(`/estates/${estateId}/bank-accounts`);
    return rows.map(r => this.mapBank(r));
  }

  /** El IBAN viaja en claro solo en esta petición; el backend lo guarda cifrado. */
  async createBankAccount(estateId: string, payload: {
    alias: string;
    iban?: string;
    bic?: string;
    bankName?: string;
    isReserveAccount?: boolean;
    isDefault?: boolean;
  }): Promise<BankAccount[]> {
    const rows = await this.api.post<any[]>(`/estates/${estateId}/bank-accounts`, payload);
    return rows.map(r => this.mapBank(r));
  }

  async updateBankAccount(estateId: string, bankAccountId: string, patch: {
    alias?: string;
    iban?: string;
    bic?: string;
    bankName?: string;
    isReserveAccount?: boolean;
    isDefault?: true;
    closed?: boolean;
  }): Promise<BankAccount[]> {
    const rows = await this.api.patch<any[]>(`/estates/${estateId}/bank-accounts/${bankAccountId}`, patch);
    return rows.map(r => this.mapBank(r));
  }

  getAccountingSettings(estateId: string): Promise<AccountingSettings> {
    return this.api.get<AccountingSettings>(`/estates/${estateId}/accounting-settings`);
  }

  updateAccountingSettings(estateId: string, cutoverDate: string): Promise<AccountingSettings> {
    return this.api.put<AccountingSettings>(`/estates/${estateId}/accounting-settings`, { cutoverDate });
  }

  /** Fondo de reserva por defecto para los ejercicios que se creen desde ahora. */
  /** Repercutir la comisión de las devoluciones al propietario (solo si lo permiten los estatutos o la junta). */
  updateReturnFeeRecharge(estateId: string, returnFeeRecharge: boolean): Promise<AccountingSettings> {
    return this.api.put<AccountingSettings>(`/estates/${estateId}/accounting-settings`, { returnFeeRecharge });
  }

  updateDefaultReserve(estateId: string, payload: {
    defaultReserveMode: ReserveMode;
    defaultReserveSharePct?: number | null;
    defaultReserveAllocationRule?: ReserveAllocationRule | null;
    defaultReserveAllocationValue?: number | null;
  }): Promise<AccountingSettings> {
    return this.api.put<AccountingSettings>(`/estates/${estateId}/accounting-settings`, payload);
  }

  // ── Saldos iniciales (fase 9) ────────────────────────────────────────────

  getOpeningBalances(estateId: string): Promise<OpeningBalancesView> {
    return this.api.get<OpeningBalancesView>(`/estates/${estateId}/opening-balances`);
  }

  /** Reemplaza TODAS las filas del borrador de una vez — el frontend siempre manda el estado completo del asistente. */
  saveOpeningDraft(estateId: string, payload: SaveOpeningDraftPayload): Promise<OpeningBalancesView> {
    return this.api.put<OpeningBalancesView>(`/estates/${estateId}/opening-balances`, payload);
  }

  /** Cálculo en vivo, sin persistir nada: totales, diferencia y avisos de saldo bancario. */
  validateOpeningBalances(estateId: string): Promise<OpeningValidateResult> {
    return this.api.post<OpeningValidateResult>(`/estates/${estateId}/opening-balances/validate`, {});
  }

  postOpeningBalances(estateId: string, differenceRole?: OpeningDifferenceRole): Promise<OpeningBalancesView> {
    return this.api.post<OpeningBalancesView>(`/estates/${estateId}/opening-balances/post`, { differenceRole });
  }

  /** Corrige un set ya contabilizado: revierte el anterior y contabiliza el borrador nuevo en la misma transacción. */
  repostOpeningBalances(estateId: string, differenceRole?: OpeningDifferenceRole): Promise<OpeningBalancesView> {
    return this.api.post<OpeningBalancesView>(`/estates/${estateId}/opening-balances/repost`, { differenceRole });
  }

  confirmNoPriorBalances(estateId: string, note?: string): Promise<void> {
    return this.api.post<void>(`/estates/${estateId}/opening-balances/no-prior-balances`, { note });
  }
}
