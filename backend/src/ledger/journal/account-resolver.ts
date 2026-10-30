import { UnprocessableEntityException } from '@nestjs/common';
import type { AccountRole, Prisma } from '../../prisma/client';
import {
  ensureChartTemplate,
  ensureDefaultBankAccount,
} from '../chart/ledger-bootstrap';
import type { AccountTarget } from '../posting/posting.types';

type Db = Prisma.TransactionClient;

/**
 * Resuelve la cuenta de cada línea dentro de la transacción del asiento.
 *
 * Una instancia por asiento: la caché vive lo que dura la contabilización y
 * nunca se comparte entre transacciones (una cuenta archivada en otra
 * transacción no se "recordaría" por error).
 */
export class AccountResolver {
  private readonly byRoleCache = new Map<AccountRole, string>();
  private readonly byBankCache = new Map<string, string>();
  private templateEnsured = false;

  constructor(
    private readonly db: Db,
    private readonly estateId: string,
  ) {}

  async resolve(target: AccountTarget): Promise<string> {
    if ('accountId' in target) return target.accountId;
    if ('bankAccountId' in target) return this.bank(target.bankAccountId);
    if (target.role === 'bank') return this.bank(null);
    return this.role(target.role);
  }

  private async role(role: AccountRole): Promise<string> {
    const cached = this.byRoleCache.get(role);
    if (cached) return cached;

    let account = await this.findByRole(role);
    if (!account && !this.templateEnsured) {
      // Finca anterior al diario: se completa la plantilla y se reintenta.
      await ensureChartTemplate(this.db, this.estateId);
      this.templateEnsured = true;
      account = await this.findByRole(role);
    }
    if (!account) {
      throw new UnprocessableEntityException(
        `La finca no tiene una cuenta activa para "${role}" en su plan contable.`,
      );
    }
    this.byRoleCache.set(role, account.id);
    return account.id;
  }

  private findByRole(role: AccountRole) {
    return this.db.chartAccount.findFirst({
      where: { estateId: this.estateId, systemRole: role, archivedAt: null },
      select: { id: true },
    });
  }

  private async bank(bankAccountId: string | null): Promise<string> {
    const key = bankAccountId ?? 'default';
    const cached = this.byBankCache.get(key);
    if (cached) return cached;

    const id =
      bankAccountId ?? (await ensureDefaultBankAccount(this.db, this.estateId));
    const bank = await this.db.bankAccount.findFirst({
      where: { id, estateId: this.estateId },
      select: { chartAccountId: true, closedAt: true },
    });
    if (!bank) {
      throw new UnprocessableEntityException(
        'La cuenta bancaria no existe en esta finca.',
      );
    }
    if (bank.closedAt) {
      throw new UnprocessableEntityException(
        'La cuenta bancaria está cerrada y no admite apuntes.',
      );
    }
    this.byBankCache.set(key, bank.chartAccountId);
    return bank.chartAccountId;
  }
}
