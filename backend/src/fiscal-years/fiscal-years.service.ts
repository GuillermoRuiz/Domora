import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FiscalYear, Prisma, ReserveMode } from '../prisma/client';
import { ensureFiscalYearRow } from '../ledger/journal/fiscal-year-row';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { ApproveFiscalYearDto } from './dto/approve-fiscal-year.dto';
import type { UpdateFiscalYearReserveDto } from './dto/update-fiscal-year-reserve.dto';

/** Ejercicio natural (1 ene-31 dic) por defecto — cubre el caso de la inmensa mayoría de comunidades. */
function calendarYearRange(year: number): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(year, 0, 1)),
    endDate: new Date(Date.UTC(year, 11, 31)),
  };
}

/**
 * Forma que ve el frontend cuando el año todavía no tiene fila propia —
 * nunca se persiste solo por leerla. La reserva muestra la configuración
 * por defecto de la finca, que es la que copiará el ejercicio al crearse.
 */
function virtualFiscalYear(
  estateId: string,
  year: number,
  reserve: {
    reserveMode: ReserveMode;
    reserveSharePct: Prisma.Decimal | null;
    reserveAllocationRule: FiscalYear['reserveAllocationRule'];
    reserveAllocationValue: Prisma.Decimal | null;
  },
): Omit<FiscalYear, 'id'> & { id: null } {
  return {
    id: null,
    estateId,
    year,
    ...calendarYearRange(year),
    status: 'Abierto',
    approvedAt: null,
    approvedNote: null,
    closedAt: null,
    closedByUserId: null,
    reopenedAt: null,
    reopenReason: null,
    ...reserve,
  };
}

@Injectable()
export class FiscalYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  /** Lectura pura — sintetiza un año virtual si todavía no existe fila (ver comentario del modelo en schema.prisma). Nunca escribe. */
  async getFiscalYear(estateId: string, year: number, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const existing = await this.prisma.fiscalYear.findUnique({
      where: { estateId_year: { estateId, year } },
    });
    return existing ?? virtualFiscalYear(estateId, year, await this.defaultReserve(estateId));
  }

  /** Para el selector de año: filas persistidas + el año en curso si todavía no tiene una (así el desplegable nunca queda vacío). */
  async listFiscalYears(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const rows = await this.prisma.fiscalYear.findMany({
      where: { estateId },
      orderBy: { year: 'desc' },
    });
    const currentYear = new Date().getFullYear();
    if (!rows.some((r) => r.year === currentYear)) {
      return [virtualFiscalYear(estateId, currentYear, await this.defaultReserve(estateId)), ...rows];
    }
    return rows;
  }

  /**
   * Alta perezosa, SOLO en escritura: la misma que usa el diario al
   * contabilizar (copia la configuración de la reserva de la finca).
   */
  private async getOrCreateFiscalYear(estateId: string, year: number) {
    await ensureFiscalYearRow(this.prisma, estateId, year);
    return this.prisma.fiscalYear.findUniqueOrThrow({
      where: { estateId_year: { estateId, year } },
    });
  }

  private async defaultReserve(estateId: string) {
    const settings = await this.prisma.accountingSettings.findUnique({
      where: { estateId },
      select: {
        defaultReserveMode: true,
        defaultReserveSharePct: true,
        defaultReserveAllocationRule: true,
        defaultReserveAllocationValue: true,
      },
    });
    return {
      reserveMode: settings?.defaultReserveMode ?? ('receipt_share' as ReserveMode),
      reserveSharePct: settings?.defaultReserveSharePct ?? null,
      reserveAllocationRule: settings?.defaultReserveAllocationRule ?? null,
      reserveAllocationValue: settings?.defaultReserveAllocationValue ?? null,
    };
  }

  /**
   * Fondo de reserva del ejercicio (ADR, D3). Solo afecta a los recibos que
   * se emitan desde ahora: los emitidos no se reescriben.
   */
  async updateReserve(
    estateId: string,
    year: number,
    dto: UpdateFiscalYearReserveDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertOpenForWrites(estateId, year);
    if (
      dto.reserveAllocationRule &&
      dto.reserveAllocationRule !== 'top_up_to_legal_minimum' &&
      (dto.reserveAllocationValue === null ||
        dto.reserveAllocationValue === undefined)
    ) {
      throw new UnprocessableEntityException(
        'Esta regla de dotación necesita un importe o porcentaje.',
      );
    }
    await this.getOrCreateFiscalYear(estateId, year);
    return this.prisma.fiscalYear.update({
      where: { estateId_year: { estateId, year } },
      data: {
        reserveMode: dto.reserveMode,
        reserveSharePct: dto.reserveSharePct === null || dto.reserveSharePct === undefined
          ? null
          : new Prisma.Decimal(dto.reserveSharePct),
        reserveAllocationRule: dto.reserveAllocationRule ?? null,
        reserveAllocationValue:
          dto.reserveAllocationValue === null ||
          dto.reserveAllocationValue === undefined
            ? null
            : new Prisma.Decimal(dto.reserveAllocationValue),
      },
    });
  }

  async approveFiscalYear(
    estateId: string,
    year: number,
    dto: ApproveFiscalYearDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.getOrCreateFiscalYear(estateId, year);
    return this.prisma.fiscalYear.update({
      where: { estateId_year: { estateId, year } },
      data: { approvedAt: new Date(), approvedNote: dto.approvedNote ?? null },
    });
  }

  /**
   * Solo bloquea escrituras de PRESUPUESTO (BudgetItem/CostCentreBudget) —
   * no la contabilización de movimientos, ver "Explícitamente fuera de este
   * plan". Un año nunca cerrado explícitamente está siempre abierto.
   */
  async assertOpenForWrites(estateId: string, year: number): Promise<void> {
    const fiscalYear = await this.prisma.fiscalYear.findUnique({
      where: { estateId_year: { estateId, year } },
      select: { status: true },
    });
    if (fiscalYear?.status === 'Cerrado') {
      throw new ConflictException(
        `El ejercicio ${year} está cerrado. No se puede modificar el presupuesto de un ejercicio ya liquidado.`,
      );
    }
  }
}
