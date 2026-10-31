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
import { SupplierVisitsService } from './supplier-visits.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: las visitas de un proveedor se programan,
 * se editan mientras estén planificadas y se cierran (realizada / cancelada)
 * sin poder volver atrás. La instalación y la incidencia son opcionales y
 * deben ser de la misma finca.
 */
const prisma = createPrismaClient();
const service = new SupplierVisitsService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
);

let admin: AdministratorFixture;
let otherAdmin: AdministratorFixture;
let estate: string;
let otherEstate: string;
let manager: AuthenticatedUser;
let supplierId: string;
let inactiveSupplierId: string;
let otherEstateSupplierId: string;
let assetId: string;
let foreignAssetId: string;
let issueId: string;
let foreignIssueId: string;

const FUTURE = '2030-03-01T09:30:00.000Z';
const visit = (extra: Record<string, unknown> = {}) =>
  ({ scheduledAt: FUTURE, purpose: 'Revisión anual', ...extra }) as never;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (visitas)',
  });
  otherAdmin = await createAdministrator(prisma, {
    name: 'Otra gestora (visitas)',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca de prueba — visitas' },
  });
  otherEstate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Otra finca — visitas' },
  });
  manager = roleB(admin, [estate]);
  const base = {
    administratorId: admin.administratorId,
    category: 'Ascensores',
  };
  supplierId = (
    await prisma.supplier.create({
      data: { ...base, estateId: estate, name: 'Ascensores Norte' },
    })
  ).id;
  inactiveSupplierId = (
    await prisma.supplier.create({
      data: {
        ...base,
        estateId: estate,
        name: 'Proveedor de baja',
        status: 'Baja',
      },
    })
  ).id;
  otherEstateSupplierId = (
    await prisma.supplier.create({
      data: { ...base, estateId: otherEstate, name: 'De otra finca' },
    })
  ).id;
  assetId = (
    await prisma.asset.create({
      data: { estateId: estate, name: 'Ascensor A', category: 'Ascensor' },
    })
  ).id;
  foreignAssetId = (
    await prisma.asset.create({
      data: { estateId: otherEstate, name: 'De otra finca', category: 'PCI' },
    })
  ).id;
  const property = await createProperty(prisma, estate, { ref: 'V1' });
  const foreignProperty = await createProperty(prisma, otherEstate, {
    ref: 'V2',
  });
  const issueBase = {
    type: 'Fuga',
    title: 'Goteras',
    description: 'Entra agua',
    status: 'Abierta',
    priority: 'Normal',
    source: 'Comunidad',
    date: new Date(),
  } as const;
  issueId = (
    await prisma.issue.create({
      data: { ...issueBase, ref: `VIS-${Date.now()}-1`, estateId: estate },
    })
  ).id;
  foreignIssueId = (
    await prisma.issue.create({
      data: { ...issueBase, ref: `VIS-${Date.now()}-2`, estateId: otherEstate },
    })
  ).id;
});

afterAll(async () => {
  await prisma.supplierVisit.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.issue.deleteMany({
    where: { id: { in: [issueId, foreignIssueId] } },
  });
  await prisma.asset.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.supplier.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, otherAdmin.administratorId);
  await prisma.$disconnect();
});

describe('SupplierVisitsService.create', () => {
  it('programa una visita planificada, sin instalación ni incidencia si no se indican', async () => {
    const v = await service.create(estate, supplierId, visit(), manager);
    expect(v.status).toBe('planificada');
    expect(v.scheduledAt.toISOString()).toBe(FUTURE);
    expect(v.asset).toBeNull();
    expect(v.issue).toBeNull();
    expect(v.completedAt).toBeNull();
  });

  it('puede ligarse a una instalación y a una incidencia de la misma finca, y la respuesta trae sus nombres', async () => {
    const v = await service.create(
      estate,
      supplierId,
      visit({ assetId, issueId }),
      manager,
    );
    expect(v.asset).toEqual({ id: assetId, name: 'Ascensor A' });
    expect(v.issue).toMatchObject({ id: issueId, title: 'Goteras' });
  });

  it('rechaza una instalación o una incidencia de otra finca', async () => {
    await expect(
      service.create(
        estate,
        supplierId,
        visit({ assetId: foreignAssetId }),
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(
        estate,
        supplierId,
        visit({ issueId: foreignIssueId }),
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un proveedor de baja, uno de otra finca y a quien no gestiona la finca', async () => {
    await expect(
      service.create(estate, inactiveSupplierId, visit(), manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(estate, otherEstateSupplierId, visit(), manager),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.create(estate, supplierId, visit(), roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('SupplierVisitsService.update', () => {
  it('edita fecha, motivo y notas de una visita planificada y permite quitar los vínculos con null', async () => {
    const created = await service.create(
      estate,
      supplierId,
      visit({ assetId, issueId }),
      manager,
    );
    const updated = await service.update(
      estate,
      supplierId,
      created.id,
      {
        purpose: 'Puesta a punto',
        notes: 'Llevar llave',
        assetId: null,
        issueId: null,
      } as never,
      manager,
    );
    expect(updated.purpose).toBe('Puesta a punto');
    expect(updated.notes).toBe('Llevar llave');
    expect(updated.asset).toBeNull();
    expect(updated.issue).toBeNull();
    expect(updated.scheduledAt.toISOString()).toBe(FUTURE); // lo que no se toca no cambia
  });

  it('no deja editar una visita ya cerrada ni una de otro proveedor', async () => {
    const created = await service.create(estate, supplierId, visit(), manager);
    await service.complete(estate, supplierId, created.id, {}, manager);
    await expect(
      service.update(
        estate,
        supplierId,
        created.id,
        { purpose: 'Otra cosa' } as never,
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const other = await prisma.supplier.create({
      data: {
        administratorId: admin.administratorId,
        category: 'Limpieza',
        estateId: estate,
        name: 'Otro',
      },
    });
    await expect(
      service.update(
        estate,
        other.id,
        created.id,
        { purpose: 'x' } as never,
        manager,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SupplierVisitsService.complete / cancel', () => {
  it('completar marca la fecha de realización y añade las notas a las que había', async () => {
    const created = await service.create(
      estate,
      supplierId,
      visit({ notes: 'Previo' }),
      manager,
    );
    const done = await service.complete(
      estate,
      supplierId,
      created.id,
      { notes: 'Todo correcto' },
      manager,
    );
    expect(done.status).toBe('realizada');
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.cancelledAt).toBeNull();
    expect(done.notes).toBe('Previo\nTodo correcto');
  });

  it('cancelar marca la fecha de cancelación', async () => {
    const created = await service.create(estate, supplierId, visit(), manager);
    const cancelled = await service.cancel(
      estate,
      supplierId,
      created.id,
      { notes: 'El proveedor no puede' },
      manager,
    );
    expect(cancelled.status).toBe('cancelada');
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.completedAt).toBeNull();
  });

  it('una visita cerrada no se puede cerrar de nuevo ni cambiar de sentido', async () => {
    const created = await service.create(estate, supplierId, visit(), manager);
    await service.cancel(estate, supplierId, created.id, {}, manager);
    await expect(
      service.complete(estate, supplierId, created.id, {}, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.cancel(estate, supplierId, created.id, {}, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SupplierVisitsService.list', () => {
  it('devuelve las visitas del proveedor, las más recientes primero, y nada de otros proveedores', async () => {
    const solo = await prisma.supplier.create({
      data: {
        administratorId: admin.administratorId,
        category: 'Jardinería',
        estateId: estate,
        name: 'Jardines Sur',
      },
    });
    await service.create(
      estate,
      solo.id,
      visit({ scheduledAt: '2030-01-01T10:00:00.000Z', purpose: 'Antigua' }),
      manager,
    );
    await service.create(
      estate,
      solo.id,
      visit({ scheduledAt: '2030-06-01T10:00:00.000Z', purpose: 'Reciente' }),
      manager,
    );
    const list = await service.list(estate, solo.id, manager);
    expect(list.map((v) => v.purpose)).toEqual(['Reciente', 'Antigua']);
    await expect(
      service.list(estate, otherEstateSupplierId, manager),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
