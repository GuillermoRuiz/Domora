import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { ESTATE_TYPE_FROM_API } from './api-shared';
import { EstatesService } from './estates.service';
import { AccountingEstate, ChartAccount } from './models';

@Injectable({ providedIn: 'root' })
export class AccountingService {
  private api = inject(ApiClientService);
  private estates = inject(EstatesService);

  /** Cacheado por finca — las cuentas contables ya no son compartidas entre fincas. */
  private chartAccountsCache = new Map<string, ChartAccount[]>();

  // ── Accounting estates ───────────────────────────────────────────────────
  // Los campos Decimal de Prisma (balance/income/expenses/reserve/
  // reserveTarget/delinquency) llegan como string por JSON (preservan
  // precisión) — sin este Number(...), sumarlos concatena strings en vez
  // de sumar, y reserve/reserveTarget en "0" produce NaN al dividir.
  private mapAccountingEstate(raw: any): AccountingEstate {
    return {
      ...raw,
      type: ESTATE_TYPE_FROM_API[raw.type] ?? raw.type,
      balance: Number(raw.balance),
      income: Number(raw.income),
      expenses: Number(raw.expenses),
      reserve: Number(raw.reserve),
      reserveTarget: Number(raw.reserveTarget),
      delinquency: Number(raw.delinquency),
    };
  }

  async listAccountingEstates(): Promise<AccountingEstate[]> {
    const estates = await this.estates.listEstates();
    const raw = await Promise.all(
      estates.map(e => this.api.get<any>(`/estates/${e.id}/accounting/summary`)),
    );
    return raw.map((r, index) => ({
      ...this.mapAccountingEstate(r),
      address: estates[index].address,
      streetNumber: estates[index].streetNumber,
      location: estates[index].location,
      catastroFacadeUrl: estates[index].catastroFacadeUrl,
    }));
  }

  async findAccountingEstateById(id: string): Promise<AccountingEstate | null> {
    const raw = await this.api.getOrNull<any>(`/estates/${id}/accounting/summary`);
    return raw ? this.mapAccountingEstate(raw) : null;
  }

  // ── Chart of accounts ────────────────────────────────────────────────────
  /** Cuentas contables de UNA finca — no se comparten con otras fincas de la gestora. */
  async listChartAccounts(estateId: string): Promise<ChartAccount[]> {
    if (!this.chartAccountsCache.has(estateId)) {
      const accounts = await this.api.get<ChartAccount[]>(`/estates/${estateId}/chart-accounts`);
      this.chartAccountsCache.set(estateId, accounts);
    }
    return this.chartAccountsCache.get(estateId)!;
  }

  async findChartAccount(estateId: string, code: string): Promise<ChartAccount | null> {
    const all = await this.listChartAccounts(estateId);
    return all.find(a => a.code === code) ?? null;
  }

  /**
   * El backend deduce la naturaleza del código (o la hereda del padre): no se
   * envía tipo. Una subcuenta debe empezar por el código de su padre.
   */
  async createChartAccount(estateId: string, payload: {
    code: string;
    name: string;
    shortName?: string;
    parentId?: string;
  }): Promise<ChartAccount> {
    const created = await this.api.post<ChartAccount>(`/estates/${estateId}/chart-accounts`, payload);
    this.chartAccountsCache.set(estateId, [...(this.chartAccountsCache.get(estateId) ?? []), created]);
    return created;
  }

  async updateChartAccount(
    estateId: string,
    accountId: string,
    patch: { name?: string; shortName?: string | null; archived?: boolean },
  ): Promise<ChartAccount> {
    const updated = await this.api.patch<ChartAccount>(`/estates/${estateId}/chart-accounts/${accountId}`, patch);
    const cached = this.chartAccountsCache.get(estateId);
    if (cached) this.chartAccountsCache.set(estateId, cached.map(a => a.id === accountId ? updated : a));
    return updated;
  }

  async deleteChartAccount(estateId: string, accountId: string): Promise<void> {
    await this.api.delete(`/estates/${estateId}/chart-accounts/${accountId}`);
    const cached = this.chartAccountsCache.get(estateId);
    if (cached) this.chartAccountsCache.set(estateId, cached.filter(a => a.id !== accountId));
  }

  /**
   * Etiqueta de display para una cuenta contable: "628 · Suministros".
   * Los objetos de la API (movements, budget items) ya traen `accountLabel`
   * — pásalo como segundo argumento. Fallback síncrono: cache local (por
   * finca) o el propio código si todavía no se cargó.
   */
  resolveAccountLabel(estateId: string, code: string, apiLabel?: string): string {
    if (apiLabel) return apiLabel;
    const acc = this.chartAccountsCache.get(estateId)?.find(a => a.code === code);
    if (!acc) return code;
    return `${code} · ${acc.shortName ?? acc.name}`;
  }
}
