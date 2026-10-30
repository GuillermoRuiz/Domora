import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { StorageService } from '../files/storage.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createSupplier,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { SuppliersService } from './suppliers.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** Integración contra Postgres real: renovar un contrato y el histórico de renovaciones de la finca. */
// Veinte transacciones a la vez abren conexiones nuevas: en máquinas lentas (Windows) superan el maxWait de 2 s por defecto.
const prisma = createPrismaClient(undefined, { transactionOptions: { maxWait: 20_000 } });
const service = new SuppliersService(prisma as unknown as PrismaService, new EstateAccessService(), undefined as unknown as StorageService);

const DAY = 86_400_000;
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const day = (offset: number) => new Date(today.getTime() + offset * DAY);
const iso = (offset: number) => day(offset).toISOString().slice(0, 10);

let admin: AdministratorFixture;
let other: AdministratorFixture;
let estate: string;
let foreignEstate: string;
let supplier: string;
let foreignSupplier: string;
let user = roleB({ userId: '', administratorId: '' } as AdministratorFixture, []);

function contract(over: Record<string, unknown> = {}) {
  return prisma.supplierContract.create({
    data: {
      supplierId: supplier, estateId: estate, serviceType: 'Ascensores', startDate: day(-300), endDate: day(20), renewalType: 'tacita',
      costAmount: '1200.00', costFrequency: 'ANNUAL', ...over,
    },
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, { name: 'Gestora de prueba (renovaciones)' });
  other = await createAdministrator(prisma, { name: 'Otra gestora (renovaciones)' });
  estate = await createLedgerEstate(prisma, admin.administratorId, { estate: { name: 'Finca — renovaciones' } });
  foreignEstate = await createLedgerEstate(prisma, other.administratorId, { estate: { name: 'Finca ajena — renovaciones' } });
  supplier = await createSupplier(prisma, estate, admin.administratorId, { name: 'Ascensores Prueba S.L.' });
  foreignSupplier = await createSupplier(prisma, foreignEstate, other.administratorId, { name: 'Proveedor ajeno' });
  user = roleB(admin, [estate]);
});

afterAll(async () => {
  await prisma.supplierContractRenewal.deleteMany({ where: { estateId: { in: [estate, foreignEstate] } } });
  await prisma.supplierContract.deleteMany({ where: { estateId: { in: [estate, foreignEstate] } } });
  await prisma.activityLogEntry.deleteMany({ where: { actorUserId: admin.userId } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, other.administratorId);
  await prisma.$disconnect();
});

describe('SuppliersService.renewSupplierContract', () => {
  it('amplía el vencimiento, conserva el importe y deja el registro con el vencimiento anterior y el nuevo', async () => {
    const c = await contract();
    const result = await service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(385) }, user);
    expect(result.contract.endDate?.toISOString().slice(0, 10)).toBe(iso(385));
    expect(result.contract.status).toBe('Activo');
    expect(result.renewal).toMatchObject({ kind: 'manual', contractId: c.id, estateId: estate, renewedByUserId: user.id });
    expect(result.renewal.previousEndDate?.toISOString().slice(0, 10)).toBe(iso(20));
    expect(result.renewal.newEndDate.toISOString().slice(0, 10)).toBe(iso(385));
    expect(result.renewal.renewedAt.toISOString().slice(0, 10)).toBe(iso(0));
    expect(Number(result.renewal.costAmount)).toBe(1200);
    expect(result.renewal.costFrequency).toBe('ANNUAL');
  });

  it('si la renovación cambia el importe o la periodicidad, el contrato y el registro lo reflejan', async () => {
    const c = await contract({ costAmount: '100.00', costFrequency: 'MONTHLY' });
    const result = await service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(400), costAmount: 110, costFrequency: 'MONTHLY', notes: 'Subida del IPC' }, user);
    expect(Number(result.contract.costAmount)).toBe(110);
    expect(Number(result.renewal.costAmount)).toBe(110);
    expect(result.renewal.notes).toBe('Subida del IPC');
    const stored = await prisma.supplierContract.findUniqueOrThrow({ where: { id: c.id } });
    expect(Number(stored.costAmount)).toBe(110);
  });

  it('puede renovar un contrato ya vencido si el nuevo vencimiento es futuro', async () => {
    const c = await contract({ endDate: day(-10) });
    const result = await service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(355) }, user);
    expect(result.contract.status).toBe('Activo');
  });

  it('registra la renovación en la actividad del gestor', async () => {
    const c = await contract({ serviceType: 'Calefacción' });
    await service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(365) }, user);
    const logged = await prisma.activityLogEntry.findFirst({ where: { actorUserId: user.id, subjectType: 'supplier', summary: { contains: 'Calefacción' } } });
    expect(logged?.summary).toMatch(/^Contrato de "Calefacción" renovado hasta el \d{2}\/\d{2}\/\d{4}$/);
  });

  it('rechaza lo que no se puede renovar y no escribe nada', async () => {
    const before = await prisma.supplierContractRenewal.count({ where: { estateId: estate } });
    const cancelled = await contract({ cancelledAt: new Date() });
    await expect(service.renewSupplierContract(estate, supplier, cancelled.id, { newEndDate: iso(365) }, user)).rejects.toThrow('cancelado');
    const indefinite = await contract({ endDate: null });
    await expect(service.renewSupplierContract(estate, supplier, indefinite.id, { newEndDate: iso(365) }, user)).rejects.toThrow('nada que renovar');
    const c = await contract({ endDate: day(100) });
    await expect(service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(100) }, user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(50) }, user)).rejects.toThrow('posterior al vencimiento actual');
    const past = await contract({ endDate: day(-100) });
    await expect(service.renewSupplierContract(estate, supplier, past.id, { newEndDate: iso(-5) }, user)).rejects.toThrow('posterior a hoy');
    expect(await prisma.supplierContractRenewal.count({ where: { estateId: estate } })).toBe(before);
    expect((await prisma.supplierContract.findUniqueOrThrow({ where: { id: c.id } })).endDate?.toISOString().slice(0, 10)).toBe(iso(100));
  });

  it('dos renovaciones a la vez: una gana y la otra recibe 409, sin duplicar el histórico', async () => {
    const c = await contract({ endDate: day(100) });
    const before = await prisma.supplierContractRenewal.count({ where: { contractId: c.id } });
    const results = await Promise.allSettled([
      service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(400) }, user),
      service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(500) }, user),
    ]);
    // Con ejecución estrictamente secuencial la segunda falla por «posterior al vencimiento actual» (400) o
    // por la condición del UPDATE (409): en ambos casos solo una renovación queda registrada.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect([BadRequestException, ConflictException].some((E) => failure.reason instanceof E)).toBe(true);
    expect(await prisma.supplierContractRenewal.count({ where: { contractId: c.id } })).toBe(before + 1);
  });

  it('no renueva un contrato cancelado entre la lectura y la escritura (409)', async () => {
    const c = await contract({ endDate: day(100) });
    const original = prisma.supplierContract.findUniqueOrThrow.bind(prisma.supplierContract);
    // Simula la cancelación concurrente: el contrato se cancela justo después de que el servicio lo lee.
    const spy = jest.spyOn(prisma.supplierContract, 'findUniqueOrThrow').mockImplementationOnce(((args: never) => {
      const read = original(args);
      return read.then(async (row: unknown) => {
        await prisma.supplierContract.update({ where: { id: c.id }, data: { cancelledAt: new Date() } });
        return row;
      });
    }) as never);
    await expect(service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(400) }, user)).rejects.toBeInstanceOf(ConflictException);
    spy.mockRestore();
    expect(await prisma.supplierContractRenewal.count({ where: { contractId: c.id } })).toBe(0);
  });

  it('una finca o un proveedor ajenos son 403/404', async () => {
    const c = await contract();
    await expect(service.renewSupplierContract(foreignEstate, foreignSupplier, c.id, { newEndDate: iso(400) }, user)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.renewSupplierContract(estate, foreignSupplier, c.id, { newEndDate: iso(400) }, user)).rejects.toThrow();
  });
});

describe('SuppliersService.listEstateRenewals', () => {
  it('devuelve las renovaciones de la finca, la más reciente primero, con contrato, proveedor e importe anual', async () => {
    const c = await contract({ serviceType: 'Jardinería', costAmount: '50.00', costFrequency: 'MONTHLY' });
    await service.renewSupplierContract(estate, supplier, c.id, { newEndDate: iso(500) }, user);
    const rows = await service.listEstateRenewals(estate, user);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const mine = rows.find((r) => r.contractId === c.id)!;
    expect(mine).toMatchObject({ serviceType: 'Jardinería', kind: 'manual', supplier: { name: 'Ascensores Prueba S.L.' } });
    expect(Number(mine.annualCost)).toBe(600);
    const dates = rows.map((r) => r.renewedAt.getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('respeta el límite, no mezcla fincas y una finca ajena es 403', async () => {
    const rows = await service.listEstateRenewals(estate, user, 2);
    expect(rows.length).toBeLessThanOrEqual(2);
    await prisma.supplierContractRenewal.create({
      data: { contractId: (await prisma.supplierContract.create({ data: { supplierId: foreignSupplier, estateId: foreignEstate, serviceType: 'X', startDate: day(-10), renewalType: 'manual' } })).id, estateId: foreignEstate, renewedAt: today, newEndDate: day(100) },
    });
    const all = await service.listEstateRenewals(estate, user);
    expect(all.every((r) => r.supplier.name !== 'Proveedor ajeno')).toBe(true);
    await expect(service.listEstateRenewals(foreignEstate, user)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SuppliersService.listEstateContracts: coste y documentos', () => {
  it('calcula coste anual y mensual con la regla única, null si no se puede anualizar, y cuenta los documentos', async () => {
    const monthly = await contract({ serviceType: 'Coste mensual', costAmount: '300.00', costFrequency: 'MONTHLY' });
    const oneOff = await contract({ serviceType: 'Coste puntual', costAmount: '900.00', costFrequency: 'ONE_OFF' });
    const noCost = await contract({ serviceType: 'Sin importe', costAmount: null, costFrequency: null });
    await prisma.supplierDocument.createMany({
      data: [1, 2].map((n) => ({ supplierId: supplier, contractId: monthly.id, documentType: 'Contrato' as const, title: `Doc ${n}`, fileName: `doc${n}.pdf`, mimeType: 'application/pdf', s3Key: `k${n}` })),
    });
    const rows = await service.listEstateContracts(estate, user);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(Number(by(monthly.id).annualCost)).toBe(3600);
    expect(Number(by(monthly.id).monthlyCost)).toBe(300);
    expect(by(monthly.id).documentCount).toBe(2);
    expect(by(oneOff.id).annualCost).toBeNull();
    expect(by(oneOff.id).monthlyCost).toBeNull();
    expect(by(noCost.id).annualCost).toBeNull();
    expect(by(noCost.id).documentCount).toBe(0);
    expect(Object.keys(by(monthly.id))).not.toContain('_count');
    await prisma.supplierDocument.deleteMany({ where: { supplierId: supplier } });
  });
});
