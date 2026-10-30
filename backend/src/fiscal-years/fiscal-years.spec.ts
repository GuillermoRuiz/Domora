import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { FiscalYearsService } from './fiscal-years.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createEstate,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Tarea 43 del tracker — FiscalYear se crea de forma perezosa SOLO en
 * escritura (mismo criterio que AccountingPeriod.upsert en
 * AccountingService.generateReceipts), nunca en el path de lectura. Este
 * spec verifica exactamente esa distinción: un año nunca tocado no debe
 * dejar fila en la tabla hasta la primera escritura real.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
const service = new FiscalYearsService(
  prisma as unknown as PrismaService,
  estateAccess,
);

const UNTOUCHED_YEAR = 2099;

let admin: AdministratorFixture;
let estateId: string;
let user: AuthenticatedUser;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (ejercicios)',
  });
  estateId = await createEstate(prisma, admin.administratorId, {
    name: 'Finca de prueba — ejercicios',
  });
  user = roleB(admin, [estateId]);
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.fiscalYear.deleteMany({ where: { estateId } });
});

describe('FiscalYearsService — lectura sin escritura', () => {
  it('getFiscalYear sintetiza un año virtual "Abierto" sin persistir ninguna fila', async () => {
    const virtual = await service.getFiscalYear(estateId, UNTOUCHED_YEAR, user);
    expect(virtual.id).toBeNull();
    expect(virtual.status).toBe('Abierto');
    expect(virtual.year).toBe(UNTOUCHED_YEAR);

    const raw = await prisma.fiscalYear.findUnique({
      where: { estateId_year: { estateId, year: UNTOUCHED_YEAR } },
    });
    expect(raw).toBeNull();
  });

  it('listFiscalYears incluye el año en curso como virtual si todavía no tiene fila', async () => {
    const currentYear = new Date().getFullYear();
    const rows = await service.listFiscalYears(estateId, user);
    expect(rows.some((r) => r.year === currentYear && r.id === null)).toBe(
      true,
    );
  });

  it('assertOpenForWrites no lanza para un año sin fila (implícitamente abierto)', async () => {
    await expect(
      service.assertOpenForWrites(estateId, UNTOUCHED_YEAR),
    ).resolves.toBeUndefined();
  });
});

describe('FiscalYearsService — aprobación y cierre', () => {
  it('approveFiscalYear crea la fila de forma perezosa y guarda approvedAt/approvedNote', async () => {
    const approved = await service.approveFiscalYear(
      estateId,
      UNTOUCHED_YEAR,
      { approvedNote: 'Aprobado en junta del 15/03' },
      user,
    );
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.approvedNote).toBe('Aprobado en junta del 15/03');

    const raw = await prisma.fiscalYear.findUnique({
      where: { estateId_year: { estateId, year: UNTOUCHED_YEAR } },
    });
    expect(raw).not.toBeNull();
  });

  // El cierre real (regularización, dotación, cierre por dimensión y
  // apertura de N+1) vive en YearCloseService — ver year-close.service.spec.ts.
  it('assertOpenForWrites lanza ConflictException tras marcar el ejercicio como Cerrado', async () => {
    await prisma.fiscalYear.upsert({
      where: { estateId_year: { estateId, year: UNTOUCHED_YEAR } },
      update: { status: 'Cerrado', closedAt: new Date() },
      create: {
        estateId,
        year: UNTOUCHED_YEAR,
        startDate: new Date(Date.UTC(UNTOUCHED_YEAR, 0, 1)),
        endDate: new Date(Date.UTC(UNTOUCHED_YEAR, 11, 31)),
        status: 'Cerrado',
        closedAt: new Date(),
      },
    });
    await expect(
      service.assertOpenForWrites(estateId, UNTOUCHED_YEAR),
    ).rejects.toThrow(ConflictException);
  });

  it('getOrCreateFiscalYear es idempotente — aprobar dos veces no crea dos filas', async () => {
    await service.approveFiscalYear(estateId, UNTOUCHED_YEAR, {}, user);
    await service.approveFiscalYear(estateId, UNTOUCHED_YEAR, {}, user);
    const rows = await prisma.fiscalYear.findMany({
      where: { estateId, year: UNTOUCHED_YEAR },
    });
    expect(rows).toHaveLength(1);
  });
});

describe('FiscalYearsService — dotación al cierre (fase 11)', () => {
  it('updateReserve guarda la regla y el valor de la dotación al cierre', async () => {
    const updated = await service.updateReserve(
      estateId,
      UNTOUCHED_YEAR,
      {
        reserveMode: 'year_end_allocation',
        reserveAllocationRule: 'pct_of_result',
        reserveAllocationValue: 25,
      },
      user,
    );
    expect(updated.reserveMode).toBe('year_end_allocation');
    expect(updated.reserveAllocationRule).toBe('pct_of_result');
    expect(Number(updated.reserveAllocationValue)).toBe(25);
  });

  it('top_up_to_legal_minimum no necesita valor', async () => {
    const updated = await service.updateReserve(
      estateId,
      UNTOUCHED_YEAR,
      {
        reserveMode: 'both',
        reserveAllocationRule: 'top_up_to_legal_minimum',
      },
      user,
    );
    expect(updated.reserveAllocationRule).toBe('top_up_to_legal_minimum');
    expect(updated.reserveAllocationValue).toBeNull();
  });

  it('fixed_amount sin valor se rechaza', async () => {
    await expect(
      service.updateReserve(
        estateId,
        UNTOUCHED_YEAR,
        { reserveMode: 'both', reserveAllocationRule: 'fixed_amount' },
        user,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
