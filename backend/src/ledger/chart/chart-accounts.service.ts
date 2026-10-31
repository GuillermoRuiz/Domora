import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ChartAccount } from '../../prisma/client';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toLedgerHttpException } from '../journal/journal-db-errors';
import { COMMUNITY_CHART_TEMPLATE, natureForCode } from './chart-template';
import { ensureChartTemplate } from './ledger-bootstrap';
import type {
  CreateChartAccountDto,
  UpdateChartAccountDto,
} from './chart-accounts.dto';

/** Etiqueta de display '628 · Suministros': siempre calculada, nunca almacenada. */
export function accountLabel(
  a: Pick<ChartAccount, 'code' | 'shortName' | 'name'>,
): string {
  return `${a.code} · ${a.shortName ?? a.name}`;
}

/**
 * Plan de cuentas de una finca. Las reglas de fondo (código del hijo,
 * naturaleza de los grupos 6 y 7, cuentas con apuntes) las garantiza la
 * base de datos; aquí se dan los mensajes claros y se deciden los permisos
 * de producto (qué se puede archivar).
 */
@Injectable()
export class ChartAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  async list(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    // Las fincas anteriores al diario completan aquí su plantilla. Solo si
    // falta algo: el UPSERT bloquearía filas en cada lectura.
    const systemAccounts = await this.prisma.chartAccount.count({
      where: { estateId, system: true },
    });
    if (systemAccounts < COMMUNITY_CHART_TEMPLATE.length) {
      await ensureChartTemplate(this.prisma, estateId);
    }
    const accounts = await this.prisma.chartAccount.findMany({
      where: { estateId },
      orderBy: { code: 'asc' },
    });
    return accounts.map((a) => ({ ...a, label: accountLabel(a) }));
  }

  async create(
    estateId: string,
    dto: CreateChartAccountDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: { administratorId: true },
    });
    if (!estate) throw new NotFoundException('La finca no existe.');

    const duplicate = await this.prisma.chartAccount.findUnique({
      where: { estateId_code: { estateId, code: dto.code } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        `Ya existe una cuenta ${dto.code} en esta finca.`,
      );
    }

    const parent = dto.parentId
      ? await this.prisma.chartAccount.findFirst({
          where: { id: dto.parentId, estateId },
        })
      : null;
    if (dto.parentId && !parent) {
      throw new NotFoundException('La cuenta padre no existe en esta finca.');
    }
    if (parent && !dto.code.startsWith(parent.code)) {
      throw new UnprocessableEntityException(
        `La subcuenta debe empezar por el código de su cuenta padre (${parent.code}).`,
      );
    }

    // Una subcuenta hereda naturaleza y exigencias de su padre: una
    // subcuenta de la 430 sigue exigiendo propiedad.
    const nature = parent?.nature ?? natureForCode(dto.code);
    try {
      const account = await this.prisma.chartAccount.create({
        data: {
          estateId,
          administratorId: estate.administratorId,
          code: dto.code,
          name: dto.name.trim(),
          shortName: dto.shortName?.trim() || null,
          nature,
          parentId: parent?.id ?? null,
          requiresProperty: parent?.requiresProperty ?? false,
          requiresSupplier: parent?.requiresSupplier ?? false,
          allowsCostCentre: nature === 'expense' || nature === 'income',
        },
      });
      return { ...account, label: accountLabel(account) };
    } catch (error) {
      throw toLedgerHttpException(error) ?? error;
    }
  }

  async update(
    estateId: string,
    accountId: string,
    dto: UpdateChartAccountDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const account = await this.findOwn(estateId, accountId);

    if (dto.archived === true) {
      if (account.systemRole) {
        throw new ForbiddenException(
          `La cuenta ${account.code} la usa la contabilidad automática (recibos, cobros, cierres) y no se puede archivar.`,
        );
      }
      const children = await this.prisma.chartAccount.count({
        where: { parentId: account.id, archivedAt: null },
      });
      if (children > 0) {
        throw new UnprocessableEntityException(
          `La cuenta ${account.code} tiene subcuentas activas: archívalas primero.`,
        );
      }
    }

    const updated = await this.prisma.chartAccount.update({
      where: { id: account.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.shortName !== undefined
          ? { shortName: dto.shortName?.trim() || null }
          : {}),
        ...(dto.archived !== undefined
          ? { archivedAt: dto.archived ? new Date() : null }
          : {}),
      },
    });
    return { ...updated, label: accountLabel(updated) };
  }

  async remove(estateId: string, accountId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const account = await this.findOwn(estateId, accountId);
    if (account.system) {
      throw new ForbiddenException(
        `La cuenta ${account.code} es del plan de la comunidad y no se puede borrar: archívala si no la usas.`,
      );
    }
    const [children, bank] = await Promise.all([
      this.prisma.chartAccount.count({ where: { parentId: account.id } }),
      this.prisma.bankAccount.count({ where: { chartAccountId: account.id } }),
    ]);
    if (children > 0) {
      throw new ConflictException(
        `La cuenta ${account.code} tiene subcuentas y no se puede borrar.`,
      );
    }
    if (bank > 0) {
      throw new ConflictException(
        `La cuenta ${account.code} es de una cuenta bancaria: ciérrala desde Bancos.`,
      );
    }
    try {
      await this.prisma.chartAccount.delete({ where: { id: account.id } });
    } catch (error) {
      // Con apuntes, o referenciada por movimientos o presupuestos antiguos.
      const ledger = toLedgerHttpException(error);
      if (ledger) throw ledger;
      throw new ConflictException(
        `La cuenta ${account.code} está en uso (movimientos o presupuestos) y no se puede borrar: archívala.`,
      );
    }
  }

  private async findOwn(estateId: string, accountId: string) {
    const account = await this.prisma.chartAccount.findFirst({
      where: { id: accountId, estateId },
    });
    if (!account)
      throw new NotFoundException('La cuenta no existe en esta finca.');
    return account;
  }
}
