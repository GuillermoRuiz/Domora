import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { SupplierOverviewService } from './supplier-overview.service';
import { SuppliersService } from './suppliers.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: el resumen del panel de Proveedores
 * (KPIs, fila por proveedor y últimas intervenciones) se deriva de contratos,
 * incidencias asignadas y visitas, y no mezcla datos de otras fincas.
 */
const prisma = createPrismaClient();
const access = new EstateAccessService();
const service = new SupplierOverviewService(
  prisma as unknown as PrismaService,
  access,
  new SuppliersService(
    prisma as unknown as PrismaService,
    access,
    undefined as never,
  ),
);

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

let admin: AdministratorFixture;
let otherAdmin: AdministratorFixture;
let estate: string;
let otherEstate: string;
let manager: AuthenticatedUser;
let userId: string;
let property: string;
const ids: Record<string, string> = {};

const create = async (
  key: string,
  data: Record<string, unknown>,
  estateId = estate,
) => {
  ids[key] = (
    await prisma.supplier.create({
      data: {
        administratorId: admin.administratorId,
        estateId,
        category: 'Ascensores',
        name: key,
        ...data,
      } as never,
    })
  ).id;
};
const contract = (
  supplierId: string,
  endInDays: number | null,
  extra: Record<string, unknown> = {},
  estateId = estate,
) =>
  prisma.supplierContract.create({
    data: {
      supplierId,
      estateId,
      serviceType: 'Mantenimiento',
      startDate: inDays(-400),
      endDate: endInDays === null ? null : inDays(endInDays),
      renewalType: 'manual',
      ...extra,
    },
  });
const visit = (
  supplierId: string,
  scheduledAt: Date,
  status: 'planificada' | 'realizada' | 'cancelada',
  extra: Record<string, unknown> = {},
  estateId = estate,
) =>
  prisma.supplierVisit.create({
    data: {
      supplierId,
      estateId,
      scheduledAt,
      purpose: 'Revisión',
      status,
      ...(status === 'realizada' && { completedAt: scheduledAt }),
      ...extra,
    },
  });
let refSeq = 0;
const issue = async (
  status: 'Abierta' | 'Resuelta',
  deletedAt: Date | null = null,
) =>
  (
    await prisma.issue.create({
      data: {
        ref: `OVW-${Date.now()}-${++refSeq}`,
        estateId: estate,
        type: 'Fuga',
        title: 'Incidencia',
        description: 'x',
        status,
        priority: 'Normal',
        source: 'Comunidad',
        date: new Date(),
        deletedAt,
      },
    })
  ).id;
const assign = (
  issueId: string,
  supplierId: string,
  unassignedAt: Date | null = null,
) =>
  prisma.issueProviderAssignment.create({
    data: {
      issueId,
      supplierId,
      providerNameSnapshot: 'x',
      assignedAt: new Date(),
      assignedByUserId: userId,
      unassignedAt,
    },
  });

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (panel proveedores)',
  });
  otherAdmin = await createAdministrator(prisma, {
    name: 'Otra gestora (panel proveedores)',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca de prueba — proveedores' },
  });
  otherEstate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Otra finca — proveedores' },
  });
  manager = roleB(admin, [estate]);
  userId = await createOwnerUser(prisma, {
    fullName: 'Quien asigna (panel proveedores)',
  });
  property = await createProperty(prisma, estate, { ref: 'P1' });

  await create('vigente', {
    contactName: 'Marta Ruiz',
    phone: '600111222',
    email: 'marta@vigente.test',
  });
  await create('por-vencer', {});
  await create('vencido', {});
  await create('de-baja', { status: 'Baja' });
  await create('sin-contrato', {});
  await create('ajeno', {}, otherEstate);

  await contract(ids['vigente'], 300);
  await contract(ids['vigente'], 90); // el que antes vence manda
  await contract(ids['por-vencer'], 10);
  await contract(ids['vencido'], -20);
  await contract(ids['sin-contrato'], 200, { cancelledAt: new Date() }); // cancelado: no cuenta
  await contract(ids['ajeno'], 5, {}, otherEstate);

  await visit(ids['vigente'], inDays(30), 'planificada', { purpose: 'Lejana' });
  await visit(ids['vigente'], inDays(7), 'planificada', { purpose: 'Cercana' });
  await visit(ids['vigente'], inDays(-3), 'planificada', {
    purpose: 'Se pasó la fecha',
  });
  await visit(ids['vigente'], inDays(2), 'cancelada', { purpose: 'Cancelada' });
  await visit(ids['por-vencer'], inDays(-5), 'realizada', {
    purpose: 'Hecha hace 5 días',
  });
  await visit(ids['vigente'], inDays(-40), 'realizada', {
    purpose: 'Hecha hace 40 días',
  });
  await visit(
    ids['ajeno'],
    inDays(-1),
    'realizada',
    { purpose: 'De otra finca' },
    otherEstate,
  );

  await assign(await issue('Abierta'), ids['vigente']);
  await assign(await issue('Abierta'), ids['vigente']);
  await assign(await issue('Resuelta'), ids['vigente']); // resuelta: no cuenta
  await assign(await issue('Abierta'), ids['vigente'], new Date()); // asignación retirada: no cuenta
  await assign(await issue('Abierta', new Date()), ids['vigente']); // borrada: no cuenta
  await assign(await issue('Abierta'), ids['por-vencer']);
});

afterAll(async () => {
  await prisma.issueProviderAssignment.deleteMany({
    where: { supplier: { estateId: { in: [estate, otherEstate] } } },
  });
  await prisma.issue.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.supplierVisit.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.supplierContract.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.supplier.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.user.deleteMany({ where: { id: userId } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, otherAdmin.administratorId);
  await prisma.$disconnect();
});

describe('SupplierOverviewService.getOverview', () => {
  it('calcula los KPIs: proveedores, contratos activos, por renovar e incidencias abiertas', async () => {
    const { kpis } = await service.getOverview(estate, manager);
    expect(kpis).toEqual({
      totalSuppliers: 5, // el de otra finca no cuenta
      activeContracts: 3, // 2 de "vigente" + "por-vencer"; el vencido y el cancelado no
      expiringContracts: 1,
      openIssues: 3, // 2 + 1 asignadas y abiertas
    });
  });

  it('devuelve una fila por proveedor, por nombre, con contacto y estado derivado', async () => {
    const { items } = await service.getOverview(estate, manager);
    expect(items.map((i) => i.name)).toEqual([
      'de-baja',
      'por-vencer',
      'sin-contrato',
      'vencido',
      'vigente',
    ]);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by['vigente']).toMatchObject({
      contactName: 'Marta Ruiz',
      phone: '600111222',
      email: 'marta@vigente.test',
      displayStatus: 'activo',
    });
    expect(by['por-vencer'].displayStatus).toBe('renovar');
    expect(by['vencido'].displayStatus).toBe('vencido');
    expect(by['de-baja'].displayStatus).toBe('baja');
    expect(by['sin-contrato'].displayStatus).toBe('activo');
  });

  it('resume cada proveedor con su contrato más urgente; un contrato cancelado no lo representa', async () => {
    const { items } = await service.getOverview(estate, manager);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by['vigente'].contract).toMatchObject({
      status: 'Activo',
      daysLeft: 90,
    });
    expect(by['por-vencer'].contract).toMatchObject({
      status: 'PorVencer',
      daysLeft: 10,
    });
    expect(by['vencido'].contract).toMatchObject({ status: 'Vencido' });
    expect(by['sin-contrato'].contract).toBeNull();
  });

  it('la próxima visita es la planificada más cercana desde hoy: ignora las pasadas, realizadas y canceladas', async () => {
    const { items } = await service.getOverview(estate, manager);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by['vigente'].nextVisit?.purpose).toBe('Cercana');
    expect(by['por-vencer'].nextVisit).toBeNull();
  });

  it('cuenta solo incidencias abiertas con proveedor asignado ahora y no borradas', async () => {
    const { items } = await service.getOverview(estate, manager);
    const by = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(by['vigente'].openIssues).toBe(2);
    expect(by['por-vencer'].openIssues).toBe(1);
    expect(by['vencido'].openIssues).toBe(0);
  });

  it('las últimas intervenciones son las visitas realizadas de esta finca, la más reciente primero', async () => {
    const { recentInterventions } = await service.getOverview(estate, manager);
    expect(recentInterventions.map((v) => v.purpose)).toEqual([
      'Hecha hace 5 días',
      'Hecha hace 40 días',
    ]);
    expect(recentInterventions[0]).toMatchObject({
      supplierName: 'por-vencer',
      supplierCategory: 'Ascensores',
    });
  });

  it('una finca sin proveedores devuelve todo a cero y no falla', async () => {
    const empty = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Finca vacía — proveedores' },
    });
    const out = await service.getOverview(empty, roleB(admin, [empty]));
    expect(out).toEqual({
      kpis: {
        totalSuppliers: 0,
        activeContracts: 0,
        expiringContracts: 0,
        openIssues: 0,
      },
      items: [],
      recentInterventions: [],
    });
  });

  it('rechaza a quien no gestiona la finca', async () => {
    await expect(
      service.getOverview(estate, roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
