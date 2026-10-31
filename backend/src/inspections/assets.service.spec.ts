import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { AssetsService } from './assets.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: el estado a mostrar de una instalación se
 * DERIVA de sus inspecciones (nada de eso se guarda), y el proveedor y la
 * finca se comprueban en el servidor.
 */
const prisma = createPrismaClient();
const service = new AssetsService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
);

const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);
const day = (n: number) => inDays(n).toISOString().slice(0, 10);

let admin: AdministratorFixture;
let otherAdmin: AdministratorFixture;
let estate: string;
let otherEstate: string;
let user: AuthenticatedUser;
let typeId: string;
let supplierId: string;
let propertyId: string;
let issueCounter = 0;

const asset = (name: string, extra: Record<string, unknown> = {}) =>
  prisma.asset.create({
    data: {
      estateId: estate,
      name,
      category: 'Ascensor',
      location: 'Portal 1',
      ...extra,
    },
  });

const inspection = (
  assetId: string,
  opts: {
    status?: 'planificada' | 'citada' | 'realizada' | 'vencida';
    next?: Date | null;
    appointment?: Date | null;
    last?: Date | null;
  },
) =>
  prisma.regulatoryInspection.create({
    data: {
      estateId: estate,
      assetId,
      inspectionTypeId: typeId,
      createdByUserId: admin.userId,
      status: opts.status ?? 'planificada',
      nextDueDate: opts.next ?? null,
      appointmentDate: opts.appointment ?? null,
      lastDoneDate: opts.last ?? null,
    },
  });

const issue = (
  assetId: string | null,
  status: 'Abierta' | 'EnReparacion' | 'Resuelta',
  deleted = false,
) => {
  issueCounter += 1;
  return prisma.issue.create({
    data: {
      ref: `INS-${Date.now()}-${issueCounter}`,
      estateId: estate,
      assetId,
      type: 'Averia',
      title: 'x',
      description: 'x',
      status,
      priority: 'Normal',
      source: 'Comunidad',
      date: new Date(),
      deletedAt: deleted ? new Date() : null,
    },
  });
};

const find = async (name: string) =>
  (await service.listInstallations(estate, user)).items.find(
    (i) => i.name === name,
  )!;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (instalaciones)',
  });
  otherAdmin = await createAdministrator(prisma, {
    name: 'Otra gestora (instalaciones)',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca de prueba — instalaciones' },
  });
  otherEstate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Otra finca — instalaciones' },
  });
  user = roleB(admin, [estate]);
  propertyId = await createProperty(prisma, estate, { ref: 'I1' });
  typeId = (
    await prisma.inspectionType.create({
      data: {
        estateId: estate,
        code: 'TEST_INSTALACIONES',
        name: 'Revisión anual obligatoria',
      },
    })
  ).id;
  supplierId = (
    await prisma.supplier.create({
      data: {
        estateId: estate,
        administratorId: admin.administratorId,
        name: 'Schindler Test',
        category: 'Ascensores',
      },
    })
  ).id;
});

afterAll(async () => {
  const estateIds = [estate, otherEstate];
  await prisma.issue.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.regulatoryInspection.deleteMany({
    where: { estateId: { in: estateIds } },
  });
  await prisma.inspectionType.deleteMany({
    where: { estateId: { in: estateIds } },
  });
  await prisma.asset.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.supplier.deleteMany({ where: { estateId: { in: estateIds } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, otherAdmin.administratorId);
  await prisma.$disconnect();
});

describe('AssetsService.listInstallations — estado derivado', () => {
  beforeAll(async () => {
    await asset('Sin revisiones');
    const far = await asset('Revisión lejana');
    await inspection(far.id, { next: inDays(200) });
    const soon = await asset('Revisión próxima');
    await inspection(soon.id, { next: inDays(10) });
    const late = await asset('Revisión vencida');
    await inspection(late.id, { status: 'vencida', next: inDays(-5) });
    const border = await asset('Justo a 30 días');
    await inspection(border.id, { next: inDays(30) });
    const maintenance = await asset('En mantenimiento', {
      operationalStatus: 'en_mantenimiento',
    });
    await inspection(maintenance.id, { next: inDays(10) }); // lo declarado manda sobre la revisión próxima
    await asset('Fuera de servicio', {
      operationalStatus: 'fuera_de_servicio',
    });
  });

  it('operativa por defecto, y sin próxima revisión no hay fecha ni días', async () => {
    expect(await find('Sin revisiones')).toMatchObject({
      operationalStatus: 'operativa',
      displayStatus: 'operativa',
      nextReviewDate: null,
      nextReviewDaysLeft: null,
      lastReviewDate: null,
    });
  });

  it('revisión lejana → operativa; ≤30 días → revisión próxima (incluido el día 30); pasada → vencida', async () => {
    expect(await find('Revisión lejana')).toMatchObject({
      displayStatus: 'operativa',
      nextReviewDaysLeft: 200,
      nextReviewDate: day(200),
    });
    expect(await find('Revisión próxima')).toMatchObject({
      displayStatus: 'revision_proxima',
      nextReviewDaysLeft: 10,
    });
    expect(await find('Justo a 30 días')).toMatchObject({
      displayStatus: 'revision_proxima',
      nextReviewDaysLeft: 30,
    });
    expect(await find('Revisión vencida')).toMatchObject({
      displayStatus: 'revision_vencida',
      nextReviewDaysLeft: -5,
    });
  });

  it('lo declarado (en mantenimiento, fuera de servicio) manda sobre la revisión', async () => {
    expect(await find('En mantenimiento')).toMatchObject({
      operationalStatus: 'en_mantenimiento',
      displayStatus: 'en_mantenimiento',
    });
    expect(await find('Fuera de servicio')).toMatchObject({
      displayStatus: 'fuera_de_servicio',
    });
  });

  it('ordena por nombre y no mezcla instalaciones de otra finca', async () => {
    await prisma.asset.create({
      data: { estateId: otherEstate, name: 'De otra finca', category: 'PCI' },
    });
    const { items } = await service.listInstallations(estate, user);
    expect(items.map((i) => i.name)).toEqual(
      [...items.map((i) => i.name)].sort((a, b) => a.localeCompare(b)),
    );
    expect(items.some((i) => i.name === 'De otra finca')).toBe(false);
  });
});

describe('AssetsService.listInstallations — revisiones', () => {
  it('última revisión = la más reciente hecha; próxima = la pendiente más cercana (la cita manda sobre el vencimiento)', async () => {
    const a = await asset('Con historial');
    await inspection(a.id, { status: 'realizada', last: inDays(-400) });
    await inspection(a.id, { status: 'realizada', last: inDays(-35) });
    await inspection(a.id, { next: inDays(90) });
    await inspection(a.id, { next: inDays(60), appointment: inDays(20) }); // cita a 20 días
    const row = await find('Con historial');
    expect(row.lastReviewDate).toBe(day(-35));
    expect(row.nextReviewDate).toBe(day(20));
    expect(row.nextReviewDaysLeft).toBe(20);
    expect(row.displayStatus).toBe('revision_proxima');
  });

  it('una inspección ya realizada no cuenta como pendiente', async () => {
    const a = await asset('Solo realizada');
    await inspection(a.id, {
      status: 'realizada',
      last: inDays(-10),
      next: inDays(5),
    });
    expect(await find('Solo realizada')).toMatchObject({
      nextReviewDate: null,
      displayStatus: 'operativa',
      lastReviewDate: day(-10),
    });
  });
});

describe('AssetsService.listInstallations — incidencias y proveedor', () => {
  it('cuenta solo las incidencias activas y no borradas de esa instalación', async () => {
    const a = await asset('Con incidencias');
    await issue(a.id, 'Abierta');
    await issue(a.id, 'EnReparacion');
    await issue(a.id, 'Resuelta');
    await issue(a.id, 'Abierta', true);
    await issue(null, 'Abierta'); // sin instalación: no cuenta en ninguna
    expect((await find('Con incidencias')).openIssues).toBe(2);
    expect((await find('Sin revisiones')).openIssues).toBe(0);
  });

  it('devuelve el proveedor responsable, o null', async () => {
    await asset('Con proveedor', { supplierId });
    expect((await find('Con proveedor')).supplier).toEqual({
      id: supplierId,
      name: 'Schindler Test',
    });
    expect((await find('Sin revisiones')).supplier).toBeNull();
  });
});

describe('AssetsService.listInstallations — calendario de revisiones', () => {
  let calendarEstate: string;
  let calendarUser: AuthenticatedUser;

  beforeAll(async () => {
    calendarEstate = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Finca calendario' },
    });
    calendarUser = roleB(admin, [calendarEstate]);
    await prisma.inspectionType.create({
      data: {
        estateId: calendarEstate,
        code: 'CAL',
        name: 'Revisión de calendario',
      },
    });
    const cal = (
      await prisma.inspectionType.findFirstOrThrow({
        where: { estateId: calendarEstate },
      })
    ).id;
    const caldera = await prisma.asset.create({
      data: {
        estateId: calendarEstate,
        name: 'Caldera',
        category: 'Calefacción',
        location: 'Sala de calderas',
        supplierId,
      },
    });
    const mk = (
      assetId: string,
      next: Date,
      status: 'planificada' | 'vencida' = 'planificada',
    ) =>
      prisma.regulatoryInspection.create({
        data: {
          estateId: calendarEstate,
          assetId,
          inspectionTypeId: cal,
          createdByUserId: admin.userId,
          status,
          nextDueDate: next,
        },
      });
    await mk(caldera.id, inDays(3));
    await mk(caldera.id, inDays(-2), 'vencida');
    await mk(caldera.id, inDays(120));
    await mk(caldera.id, inDays(300)); // fuera del horizonte de 6 meses
  });

  afterAll(async () => {
    await prisma.regulatoryInspection.deleteMany({
      where: { estateId: calendarEstate },
    });
    await prisma.inspectionType.deleteMany({
      where: { estateId: calendarEstate },
    });
    await prisma.asset.deleteMany({ where: { estateId: calendarEstate } });
  });

  it('lista las vencidas y las de los próximos 6 meses, en orden de fecha, con proveedor y ubicación', async () => {
    const { upcoming } = await service.listInstallations(
      calendarEstate,
      calendarUser,
    );
    expect(upcoming.map((u) => u.daysLeft)).toEqual([-2, 3, 120]);
    expect(upcoming[0]).toMatchObject({
      overdue: true,
      assetName: 'Caldera',
      location: 'Sala de calderas',
      title: 'Revisión de calendario',
      supplierName: 'Schindler Test',
    });
    expect(upcoming[1]).toMatchObject({ overdue: false, dueDate: day(3) });
  });
});

describe('AssetsService.listInstallations — acceso', () => {
  it('una gestora ajena no puede verlo', async () => {
    await expect(
      service.listInstallations(estate, roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AssetsService — alta y edición', () => {
  it('createAsset acepta estado operativo y proveedor, y rechaza un proveedor de otra finca', async () => {
    const created = await service.createAsset(
      estate,
      {
        name: 'Alta nueva',
        category: 'PCI',
        operationalStatus: 'en_mantenimiento',
        supplierId,
      },
      user,
    );
    expect(created).toMatchObject({
      operationalStatus: 'en_mantenimiento',
      supplierId,
    });
    const foreign = await prisma.supplier.create({
      data: {
        estateId: otherEstate,
        administratorId: admin.administratorId,
        name: 'Proveedor ajeno',
        category: 'PCI',
      },
    });
    await expect(
      service.createAsset(
        estate,
        { name: 'X', category: 'PCI', supplierId: foreign.id },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateAsset cambia solo lo enviado, permite quitar el proveedor y borrar campos opcionales', async () => {
    const a = await asset('Para editar', {
      supplierId,
      manufacturer: 'Otis',
      notes: 'nota',
    });
    const out = await service.updateAsset(
      estate,
      a.id,
      {
        operationalStatus: 'fuera_de_servicio',
        manufacturer: null,
        supplierId: null,
      },
      user,
    );
    expect(out).toMatchObject({
      name: 'Para editar',
      location: 'Portal 1',
      notes: 'nota',
      operationalStatus: 'fuera_de_servicio',
      manufacturer: null,
      supplierId: null,
    });
  });

  it('updateAsset no deja vaciar nombre ni tipo, ni usar un proveedor ajeno, ni tocar instalaciones de otra finca', async () => {
    const a = await asset('Protegida');
    await expect(
      service.updateAsset(estate, a.id, { name: null as never }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.updateAsset(estate, a.id, { category: null as never }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    const foreign = await prisma.supplier.findFirstOrThrow({
      where: { estateId: otherEstate },
    });
    await expect(
      service.updateAsset(estate, a.id, { supplierId: foreign.id }, user),
    ).rejects.toBeInstanceOf(BadRequestException);
    const elsewhere = await prisma.asset.findFirstOrThrow({
      where: { estateId: otherEstate },
    });
    await expect(
      service.updateAsset(estate, elsewhere.id, { name: 'Hack' }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateAsset(
        estate,
        a.id,
        { name: 'Nada' },
        roleB(otherAdmin, []),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('al borrar un proveedor la instalación se queda sin proveedor (no se borra)', async () => {
    const sup = await prisma.supplier.create({
      data: {
        estateId: estate,
        administratorId: admin.administratorId,
        name: 'Temporal',
        category: 'PCI',
      },
    });
    const a = await asset('Con proveedor temporal', { supplierId: sup.id });
    await prisma.supplier.delete({ where: { id: sup.id } });
    expect(
      (await prisma.asset.findUniqueOrThrow({ where: { id: a.id } }))
        .supplierId,
    ).toBeNull();
  });
});
