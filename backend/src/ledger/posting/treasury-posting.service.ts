import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AccountRole, Prisma } from '../../prisma/client';
import { JournalService } from '../journal/journal.service';
import { accountingDay } from './draft-validation';
import type { AccountTarget } from './posting.types';
import type { Cents } from '../money';
import type { PostedEntry } from './posting.types';

type Db = Prisma.TransactionClient;

/** Dónde sale o entra el dinero: una cuenta bancaria o la caja. */
export type MoneyPlace = { bankAccountId: string } | { cash: true };

/** Contrapartidas que tienen su propio flujo, y dónde se hace cada uno. */
const OWN_FLOW: Partial<Record<AccountRole, string>> = {
  owners_receivable:
    'Los cobros de propietarios se registran en Recibos, con "Registrar cobro".',
  suppliers_payable:
    'Los pagos a proveedores se hacen registrando la factura y pagándola en Proveedores.',
  creditors_payable:
    'Los pagos a proveedores se hacen registrando la factura y pagándola en Proveedores.',
  suspense:
    'Los ingresos sin identificar se registran en Recibos, "Ingresos sin identificar".',
  withholding_payable:
    'El ingreso de retenciones se registra en Impuestos, modelo 111.',
  social_security_payable:
    'El pago de la Seguridad Social se registra en Nóminas.',
  salaries_payable: 'El pago de nóminas se registra en Nóminas.',
};

/**
 * Tesorería rápida (fase 8): lo que entra o sale del banco sin documento
 * propio en Domora —una comisión, unos intereses, un gasto pequeño pagado en
 * efectivo, un ingreso por alquiler— y los traspasos entre cuentas. Genera
 * un asiento de dos líneas; cualquier otra cosa va por su flujo o por un
 * asiento manual.
 */
@Injectable()
export class TreasuryPostingService {
  constructor(private readonly journal: JournalService) {}

  async quickEntry(
    db: Db,
    input: {
      estateId: string;
      date: Date;
      direction: 'in' | 'out';
      amount: Cents;
      place: MoneyPlace;
      counterpartAccountId: string;
      costCentreId?: string | null;
      concept: string;
      reference?: string | null;
      userId?: string;
    },
  ): Promise<PostedEntry> {
    this.assertAmount(input.amount);
    const account = await db.chartAccount.findFirst({
      where: { id: input.counterpartAccountId, estateId: input.estateId },
      select: {
        code: true,
        nature: true,
        systemRole: true,
        postable: true,
        archivedAt: true,
        allowsCostCentre: true,
      },
    });
    if (!account)
      throw new NotFoundException('La cuenta no existe en esta finca.');
    const ownFlow = account.systemRole
      ? OWN_FLOW[account.systemRole]
      : undefined;
    if (ownFlow) throw new UnprocessableEntityException(ownFlow);
    if (
      account.systemRole === 'bank' ||
      account.systemRole === 'cash' ||
      account.code.startsWith('572')
    ) {
      throw new UnprocessableEntityException(
        'Para mover dinero entre bancos o la caja usa "Traspaso".',
      );
    }
    if (account.nature !== 'income' && account.nature !== 'expense') {
      throw new UnprocessableEntityException(
        `La cuenta ${account.code} no es de ingresos ni de gastos: usa un asiento manual.`,
      );
    }
    if (!account.postable || account.archivedAt) {
      throw new UnprocessableEntityException(
        `La cuenta ${account.code} no admite apuntes.`,
      );
    }
    if (input.costCentreId && !account.allowsCostCentre) {
      throw new UnprocessableEntityException(
        `La cuenta ${account.code} no admite centro de coste.`,
      );
    }
    const money = this.target(input.place);
    const counterpart = {
      account: { accountId: input.counterpartAccountId },
      costCentreId: input.costCentreId ?? undefined,
    };
    return this.journal.post(db, {
      estateId: input.estateId,
      date: accountingDay(input.date),
      sourceType: 'treasury',
      concept: input.concept,
      reference: input.reference?.slice(0, 100) ?? undefined,
      createdByUserId: input.userId,
      lines:
        input.direction === 'in'
          ? [
              { account: money, debit: input.amount },
              { ...counterpart, credit: input.amount },
            ]
          : [
              { ...counterpart, debit: input.amount },
              { account: money, credit: input.amount },
            ],
    });
  }

  async transfer(
    db: Db,
    input: {
      estateId: string;
      date: Date;
      amount: Cents;
      from: MoneyPlace;
      to: MoneyPlace;
      concept?: string;
      userId?: string;
    },
  ): Promise<PostedEntry> {
    this.assertAmount(input.amount);
    const key = (p: MoneyPlace) => ('cash' in p ? 'cash' : p.bankAccountId);
    if (key(input.from) === key(input.to)) {
      throw new UnprocessableEntityException(
        'El origen y el destino del traspaso son la misma cuenta.',
      );
    }
    for (const place of [input.from, input.to]) {
      if ('bankAccountId' in place) {
        const bank = await db.bankAccount.findFirst({
          where: { id: place.bankAccountId, estateId: input.estateId },
          select: { closedAt: true },
        });
        if (!bank)
          throw new NotFoundException(
            'La cuenta bancaria no existe en esta finca.',
          );
        if (bank.closedAt)
          throw new UnprocessableEntityException(
            'La cuenta bancaria está cerrada.',
          );
      }
    }
    return this.journal.post(db, {
      estateId: input.estateId,
      date: accountingDay(input.date),
      sourceType: 'treasury',
      concept: input.concept?.trim() || 'Traspaso entre cuentas',
      createdByUserId: input.userId,
      lines: [
        { account: this.target(input.to), debit: input.amount },
        { account: this.target(input.from), credit: input.amount },
      ],
    });
  }

  private target(place: MoneyPlace): AccountTarget {
    return 'cash' in place
      ? { role: 'cash' }
      : { bankAccountId: place.bankAccountId };
  }

  private assertAmount(amount: Cents): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new UnprocessableEntityException(
        'El importe debe ser mayor que cero.',
      );
    }
  }
}
