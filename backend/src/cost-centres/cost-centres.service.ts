import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { executedByCostCentre } from '../ledger/executed';
import type { CreateCostCentreDto } from './dto/create-cost-centre.dto';
import type { UpdateCostCentreDto } from './dto/update-cost-centre.dto';

@Injectable()
export class CostCentresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  /**
   * `budgeted`/`executed` son del ejercicio en curso (año natural actual) —
   * mismo criterio de "derivar, nunca almacenar" que ya usa
   * el presupuesto (BudgetService): lo ejecutado sale del diario. Un único groupBy sobre el conjunto
   * completo de centros, no N+1 (mismo patrón que
   * SuppliersService.listSuppliers con ytdSpend).
   */
  async listCostCentres(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const centres = await this.prisma.costCentre.findMany({
      where: { estateId },
      orderBy: { name: 'asc' },
    });
    if (centres.length === 0) return [];

    const centreIds = centres.map((c) => c.id);
    const fiscalYear = new Date().getFullYear();

    const [budgets, executedByCentre] = await Promise.all([
      this.prisma.costCentreBudget.findMany({
        where: { costCentreId: { in: centreIds }, fiscalYear },
      }),
      executedByCostCentre(this.prisma, [estateId], fiscalYear, centreIds),
    ]);

    const budgetMap = new Map(budgets.map((b) => [b.costCentreId, b.budgeted]));
    const executedMap = executedByCentre;

    return centres.map((centre) => ({
      ...centre,
      budgeted: budgetMap.get(centre.id) ?? null,
      executed: executedMap.get(centre.id) ?? new Prisma.Decimal(0),
    }));
  }

  async createCostCentre(estateId: string, dto: CreateCostCentreDto, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    if (!user.administratorId) {
      throw new ForbiddenException('Usuario sin gestora asociada.');
    }
    const existing = await this.prisma.costCentre.findFirst({
      where: { estateId, name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Ya existe un centro de coste "${dto.name}" en esta finca.`);
    }
    return this.prisma.costCentre.create({
      data: { ...dto, estateId, administratorId: user.administratorId },
    });
  }

  private async assertCostCentreInEstate(estateId: string, costCentreId: string): Promise<void> {
    const centre = await this.prisma.costCentre.findUnique({
      where: { id: costCentreId },
      select: { estateId: true },
    });
    if (!centre || centre.estateId !== estateId) {
      throw new NotFoundException('Centro de coste no encontrado en esta finca.');
    }
  }

  async updateCostCentre(
    estateId: string,
    costCentreId: string,
    dto: UpdateCostCentreDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertCostCentreInEstate(estateId, costCentreId);
    return this.prisma.costCentre.update({
      where: { id: costCentreId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }
}
