import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { CostCentresService } from './cost-centres.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  purgeAdministrator,
} from '../testing/db-fixtures';
import { JournalService } from '../ledger/journal/journal.service';
import { TreasuryPostingService } from '../ledger/posting/treasury-posting.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Tarea 43 del tracker ("Budgets, cost centres & analysis") — CostCentre no
 * existía en absoluto en el codebase (confirmado por grep exhaustivo antes
 * de construirlo). Integración contra Postgres real, mismo criterio que
 * suppliers.spec.ts: CRUD + agregados derivados (budgeted/executed) son
 * exactamente lo que un mock no verifica de verdad.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
const service = new CostCentresService(
  prisma as unknown as PrismaService,
  estateAccess,
);
const treasury = new TreasuryPostingService(new JournalService());

jest.setTimeout(60_000);

const ROLE_B = (id: string, estateIds: string[]): AuthenticatedUser => ({
  id,
  role: 'B' as AppRole,
  estateIds,
  administratorId,
});

let administratorId: string;
let estateId: string;
let accountId: string;
let bUserId: string;
let user: AuthenticatedUser;

interface Fixture {
  costCentreIds: string[];
}

function emptyFixture(): Fixture {
  return { costCentreIds: [] };
}

async function makeCostCentre(
  fixture: Fixture,
  overrides: Partial<{ name: string }> = {},
) {
  const c = await prisma.costCentre.create({
    data: {
      estateId,
      administratorId,
      name: overrides.name ?? 'Piscina',
    },
  });
  fixture.costCentreIds.push(c.id);
  return c;
}

/** Gasto real en el diario: carga la 622 con el centro de coste y abona la caja. */
async function spend(costCentreId: string, euros: number, date: string) {
  await prisma.$transaction((tx) =>
    treasury.quickEntry(tx, {
      estateId,
      date: new Date(`${date}T00:00:00Z`),
      direction: 'out',
      amount: Math.round(euros * 100),
      place: { cash: true },
      counterpartAccountId: accountId,
      costCentreId,
      concept: 'Gasto de prueba',
    }),
  );
}

/** Los centros con apuntes no se pueden borrar: se quedan hasta la purga final. */
async function cleanup(fixture: Fixture): Promise<void> {
  if (!fixture.costCentreIds.length) return;
  const used = await prisma.journalLine.findMany({
    where: { costCentreId: { in: fixture.costCentreIds } },
    select: { costCentreId: true },
    distinct: ['costCentreId'],
  });
  const usedIds = new Set(used.map((l) => l.costCentreId));
  await prisma.costCentre.deleteMany({
    where: {
      id: { in: fixture.costCentreIds.filter((id) => !usedIds.has(id)) },
    },
  });
}

beforeAll(async () => {
  const admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (centros de coste)',
  });
  administratorId = admin.administratorId;
  bUserId = admin.userId;
  const currentYear = new Date().getFullYear();
  estateId = await createLedgerEstate(prisma, administratorId, {
    cutoverDate: new Date(`${currentYear - 1}-01-01T00:00:00Z`),
  });
  accountId = (
    await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: '622' },
    })
  ).id;
  user = ROLE_B(bUserId, [estateId]);
});

afterAll(async () => {
  await purgeAdministrator(prisma, administratorId);
  await prisma.$disconnect();
});

describe('CostCentresService — CRUD', () => {
  it('crea un centro de coste con status "Activo" por defecto', async () => {
    const fx = emptyFixture();
    try {
      const created = await service.createCostCentre(
        estateId,
        { name: 'Ascensor Portal A' } as any,
        user,
      );
      fx.costCentreIds.push(created.id);
      expect(created.status).toBe('Activo');
    } finally {
      await cleanup(fx);
    }
  });

  it('rechaza un nombre duplicado en la misma finca', async () => {
    const fx = emptyFixture();
    try {
      await makeCostCentre(fx, { name: 'Jardín' });
      await expect(
        service.createCostCentre(estateId, { name: 'Jardín' } as any, user),
      ).rejects.toThrow(ConflictException);
    } finally {
      await cleanup(fx);
    }
  });

  it('updateCostCentre permite archivar sin borrar (nunca hard-delete)', async () => {
    const fx = emptyFixture();
    try {
      const centre = await makeCostCentre(fx);
      const updated = await service.updateCostCentre(
        estateId,
        centre.id,
        { status: 'Archivado' } as any,
        user,
      );
      expect(updated.status).toBe('Archivado');
      const stillThere = await prisma.costCentre.findUnique({
        where: { id: centre.id },
      });
      expect(stillThere).not.toBeNull();
    } finally {
      await cleanup(fx);
    }
  });

  it('lanza NotFoundException si el centro de coste no es de esa finca', async () => {
    const fx = emptyFixture();
    try {
      const centre = await makeCostCentre(fx);
      const otherEstate = await prisma.estate.create({
        data: {
          administratorId,
          name: 'Otra finca',
          type: 'Edificio',
          address: 'x',
          location: 'x',
        },
      });
      try {
        await expect(
          service.updateCostCentre(
            otherEstate.id,
            centre.id,
            { name: 'x' } as any,
            ROLE_B(bUserId, [otherEstate.id]),
          ),
        ).rejects.toThrow(NotFoundException);
      } finally {
        await prisma.estate.delete({ where: { id: otherEstate.id } });
      }
    } finally {
      await cleanup(fx);
    }
  });

  it('deniega el acceso a una finca fuera del scope del usuario', async () => {
    const outsider = ROLE_B(bUserId, ['00000000-0000-0000-0000-000000000000']);
    await expect(service.listCostCentres(estateId, outsider)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('CostCentresService — budgeted/executed derivados', () => {
  it('listCostCentres deriva executed del año en curso sumando los apuntes del diario etiquetados', async () => {
    const fx = emptyFixture();
    try {
      const centre = await makeCostCentre(fx, { name: 'Piscina con gasto' });
      const currentYear = new Date().getFullYear();
      await spend(centre.id, 150, `${currentYear}-03-01`);
      await spend(centre.id, 50, `${currentYear}-06-01`);
      // Fuera del año en curso — no debe contar.
      await spend(centre.id, 999, `${currentYear - 1}-06-01`);

      const rows = await service.listCostCentres(estateId, user);
      const row = rows.find((r) => r.id === centre.id)!;
      expect(row.executed.toString()).toBe('200');
    } finally {
      await cleanup(fx);
    }
  });

  it('sin apuntes etiquetados, executed es cero y budgeted es null', async () => {
    const fx = emptyFixture();
    try {
      const centre = await makeCostCentre(fx, { name: 'Sin gasto' });
      const rows = await service.listCostCentres(estateId, user);
      const row = rows.find((r) => r.id === centre.id)!;
      expect(row.executed.toString()).toBe('0');
      expect(row.budgeted).toBeNull();
    } finally {
      await cleanup(fx);
    }
  });
});
