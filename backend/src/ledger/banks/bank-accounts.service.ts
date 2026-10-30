import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../sepa/crypto.service';
import {
  createBankAccountWithSubaccount,
  ensureDefaultBankAccount,
} from '../chart/ledger-bootstrap';
import type {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from './bank-accounts.dto';

export interface BankAccountView {
  id: string;
  alias: string;
  accountCode: string;
  ibanMasked: string | null;
  bic: string | null;
  bankName: string | null;
  isDefault: boolean;
  isReserveAccount: boolean;
  openedOn: Date | null;
  closedAt: Date | null;
  /** Saldo contable (debe − haber) de su subcuenta 572. */
  balance: string;
}

/**
 * Cuentas bancarias de la comunidad. Cada una es una subcuenta 572xxxx del
 * plan; el IBAN se guarda cifrado y solo sale enmascarado.
 */
@Injectable()
export class BankAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly crypto: CryptoService,
  ) {}

  async list(
    estateId: string,
    user: AuthenticatedUser,
  ): Promise<BankAccountView[]> {
    this.estateAccess.assertAccess(estateId, user);
    // Las fincas anteriores al diario reciben aquí su cuenta por defecto.
    await this.prisma.$transaction((tx) =>
      ensureDefaultBankAccount(tx, estateId),
    );
    const banks = await this.prisma.bankAccount.findMany({
      where: { estateId },
      include: { chartAccount: { select: { id: true, code: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const balances = await this.balances(banks.map((b) => b.chartAccountId));
    return banks.map((b) => ({
      id: b.id,
      alias: b.alias,
      accountCode: b.chartAccount.code,
      ibanMasked: this.mask(b.ibanEnc),
      bic: b.bic,
      bankName: b.bankName,
      isDefault: b.isDefault,
      isReserveAccount: b.isReserveAccount,
      openedOn: b.openedOn,
      closedAt: b.closedAt,
      balance: (
        balances.get(b.chartAccountId) ?? new Prisma.Decimal(0)
      ).toFixed(2),
    }));
  }

  async create(
    estateId: string,
    dto: CreateBankAccountDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.prisma.$transaction(async (tx) => {
      const hasDefault = await tx.bankAccount.count({
        where: { estateId, isDefault: true },
      });
      const makeDefault = dto.isDefault === true || hasDefault === 0;
      if (makeDefault) {
        await tx.bankAccount.updateMany({
          where: { estateId, isDefault: true },
          data: { isDefault: false },
        });
      }
      await createBankAccountWithSubaccount(tx, estateId, {
        alias: dto.alias.trim(),
        ibanEnc: dto.iban ? this.crypto.encrypt(dto.iban) : null,
        ibanLast4: dto.iban ? dto.iban.slice(-4) : null,
        bic: dto.bic?.toUpperCase() ?? null,
        bankName: dto.bankName?.trim() || null,
        isDefault: makeDefault,
        isReserveAccount: dto.isReserveAccount ?? false,
        openedOn: dto.openedOn
          ? new Date(`${dto.openedOn.slice(0, 10)}T00:00:00Z`)
          : null,
      });
    });
    return this.list(estateId, user);
  }

  async update(
    estateId: string,
    bankAccountId: string,
    dto: UpdateBankAccountDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: bankAccountId, estateId },
    });
    if (!bank)
      throw new NotFoundException(
        'La cuenta bancaria no existe en esta finca.',
      );

    if (dto.isDefault === false) {
      throw new UnprocessableEntityException(
        'Para cambiar la cuenta por defecto, marca como predeterminada otra cuenta.',
      );
    }
    const closing = dto.closed === true && !bank.closedAt;
    if (closing) {
      if (bank.isDefault) {
        throw new UnprocessableEntityException(
          'No se puede cerrar la cuenta por defecto: elige antes otra cuenta predeterminada.',
        );
      }
      const balance = (await this.balances([bank.chartAccountId])).get(
        bank.chartAccountId,
      );
      if (balance && !balance.isZero()) {
        throw new UnprocessableEntityException(
          `La cuenta tiene saldo (${balance.toFixed(2)} €): traspásalo antes de cerrarla.`,
        );
      }
    }
    if (dto.isDefault === true && bank.closedAt && dto.closed !== false) {
      throw new UnprocessableEntityException(
        'Una cuenta cerrada no puede ser la predeterminada.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true && !bank.isDefault) {
        // El índice único parcial exige quitar la marca a la anterior antes.
        await tx.bankAccount.updateMany({
          where: { estateId, isDefault: true },
          data: { isDefault: false },
        });
      }
      await tx.bankAccount.update({
        where: { id: bank.id },
        data: {
          ...(dto.alias !== undefined ? { alias: dto.alias.trim() } : {}),
          ...(dto.iban !== undefined
            ? {
                ibanEnc: this.crypto.encrypt(dto.iban),
                ibanLast4: dto.iban.slice(-4),
              }
            : {}),
          ...(dto.bic !== undefined ? { bic: dto.bic.toUpperCase() } : {}),
          ...(dto.bankName !== undefined
            ? { bankName: dto.bankName.trim() || null }
            : {}),
          ...(dto.isReserveAccount !== undefined
            ? { isReserveAccount: dto.isReserveAccount }
            : {}),
          ...(dto.isDefault === true ? { isDefault: true } : {}),
          ...(dto.closed !== undefined
            ? { closedAt: dto.closed ? new Date() : null }
            : {}),
        },
      });
      if (dto.alias !== undefined) {
        // El nombre de la subcuenta sigue al alias del banco.
        await tx.chartAccount.update({
          where: { id: bank.chartAccountId },
          data: {
            name: `Banco — ${dto.alias.trim()}`.slice(0, 150),
            shortName: dto.alias.trim().slice(0, 60),
          },
        });
      }
    });
    return this.list(estateId, user);
  }

  private mask(ibanEnc: string | null): string | null {
    if (!ibanEnc) return null;
    try {
      return this.crypto.maskIban(this.crypto.decrypt(ibanEnc));
    } catch {
      return null;
    }
  }

  private async balances(
    chartAccountIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (chartAccountIds.length === 0) return new Map();
    const rows = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: chartAccountIds } },
      _sum: { debit: true, credit: true },
    });
    return new Map(
      rows.map((r) => [
        r.accountId,
        (r._sum.debit ?? new Prisma.Decimal(0)).minus(
          r._sum.credit ?? new Prisma.Decimal(0),
        ),
      ]),
    );
  }
}
