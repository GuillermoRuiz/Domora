import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import type { NotificationsService } from '../notifications/notifications.service';
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
import { IssuesService } from './issues.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: el vínculo incidencia → instalación es
 * OPCIONAL, solo lo maneja la gestión y la instalación debe ser de la misma
 * finca que la incidencia.
 */
const prisma = createPrismaClient();
const notifications = {
  notify: jest.fn(),
  notifyUsers: jest.fn(),
} as unknown as NotificationsService;
const estateAccess = new EstateAccessService();
const service = new IssuesService(
  prisma as unknown as PrismaService,
  estateAccess,
  notifications,
  undefined,
  undefined,
  new PropertyAccessService(prisma as unknown as PrismaService, estateAccess),
);

let admin: AdministratorFixture;
let otherAdmin: AdministratorFixture;
let estate: string;
let otherEstate: string;
let propertyId: string;
let manager: AuthenticatedUser;
let owner: AuthenticatedUser;
let roofId: string;
let liftId: string;
let foreignAssetId: string;
let ownerId: string;

const dto = (extra: Record<string, unknown> = {}) =>
  ({
    type: 'Fuga',
    title: 'Goteras',
    description: 'Entra agua',
    priority: 'Normal',
    ...extra,
  }) as never;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (incidencias)',
  });
  otherAdmin = await createAdministrator(prisma, {
    name: 'Otra gestora (incidencias)',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca de prueba — incidencias' },
  });
  otherEstate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Otra finca — incidencias' },
  });
  propertyId = await createProperty(prisma, estate, { ref: 'X1' });
  manager = roleB(admin, [estate]);
  ownerId = await createOwnerUser(prisma, {
    fullName: 'Propietario de prueba (incidencias)',
  });
  owner = {
    id: ownerId,
    role: 'C',
    estateIds: [estate],
    administratorId: null,
  } as unknown as AuthenticatedUser;
  await prisma.propertyMembership.create({
    data: {
      propertyId,
      userId: ownerId,
      roleType: 'Propietario',
      status: 'linked',
      linkedAt: new Date(),
    },
  });
  roofId = (
    await prisma.asset.create({
      data: { estateId: estate, name: 'Cubierta', category: 'Cubierta' },
    })
  ).id;
  liftId = (
    await prisma.asset.create({
      data: { estateId: estate, name: 'Ascensor A', category: 'Ascensor' },
    })
  ).id;
  foreignAssetId = (
    await prisma.asset.create({
      data: { estateId: otherEstate, name: 'De otra finca', category: 'PCI' },
    })
  ).id;
});

afterAll(async () => {
  await prisma.issue.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.asset.deleteMany({
    where: { estateId: { in: [estate, otherEstate] } },
  });
  await prisma.propertyMembership.deleteMany({ where: { userId: ownerId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, otherAdmin.administratorId);
  await prisma.$disconnect();
});

describe('IssuesService.create — instalación opcional', () => {
  it('sin instalación sigue funcionando como siempre (el tejado sin dar de alta)', async () => {
    const issue = await service.create(estate, dto(), manager);
    expect(issue.assetId).toBeNull();
  });

  it('la gestión puede vincularla al crear', async () => {
    const issue = await service.create(
      estate,
      dto({ assetId: roofId }),
      manager,
    );
    expect(issue.assetId).toBe(roofId);
    expect(issue.asset).toEqual({ id: roofId, name: 'Cubierta' }); // la respuesta ya trae el nombre
  });

  it('el propietario no puede vincular una instalación, pero sí crear la incidencia sin ella', async () => {
    await expect(
      service.create(estate, dto({ assetId: roofId }), owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    const issue = await service.create(estate, dto(), owner);
    expect(issue).not.toHaveProperty('assetId'); // el vecino no recibe nada de la instalación
    expect(issue.source).toBe('Propietario');
  });

  it('rechaza una instalación de otra finca', async () => {
    await expect(
      service.create(estate, dto({ assetId: foreignAssetId }), manager),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('IssuesService.setAsset', () => {
  it('vincula, cambia y quita la instalación, dejando constancia en el historial', async () => {
    const issue = await service.create(estate, dto(), manager);
    const linked = await service.setAsset(
      issue.id,
      { assetId: liftId },
      manager,
    );
    expect(linked?.assetId).toBe(liftId);
    expect(linked?.asset).toEqual({ id: liftId, name: 'Ascensor A' });
    expect(
      linked?.timeline.some(
        (t) => t.text === 'Instalación vinculada: Ascensor A.',
      ),
    ).toBe(true);

    const changed = await service.setAsset(
      issue.id,
      { assetId: roofId },
      manager,
    );
    expect(changed?.asset).toEqual({ id: roofId, name: 'Cubierta' });

    const cleared = await service.setAsset(
      issue.id,
      { assetId: null },
      manager,
    );
    expect(cleared?.assetId).toBeNull();
    expect(cleared?.asset).toBeNull();
    expect(
      cleared?.timeline.some(
        (t) => t.text === 'Se ha quitado la instalación vinculada.',
      ),
    ).toBe(true);
  });

  it('repetir lo mismo no ensucia el historial', async () => {
    const issue = await service.create(
      estate,
      dto({ assetId: roofId }),
      manager,
    );
    const before = (await service.findById(issue.id, manager))!.timeline.length;
    await service.setAsset(issue.id, { assetId: roofId }, manager);
    expect((await service.findById(issue.id, manager))!.timeline).toHaveLength(
      before,
    );
  });

  it('rechaza una instalación de otra finca y al propietario', async () => {
    const issue = await service.create(estate, dto(), manager);
    await expect(
      service.setAsset(issue.id, { assetId: foreignAssetId }, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setAsset(issue.id, { assetId: roofId }, owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setAsset(issue.id, { assetId: roofId }, roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('IssuesService — lo que se devuelve y se filtra', () => {
  it('el listado de la finca trae la instalación y se puede filtrar por ella', async () => {
    const onRoof = await service.create(
      estate,
      dto({ title: 'Del tejado', assetId: roofId }),
      manager,
    );
    await service.create(
      estate,
      dto({ title: 'Del ascensor', assetId: liftId }),
      manager,
    );
    const all = await service.listByEstate(estate, manager, { pageSize: 100 });
    expect(all.items.find((i) => i.id === onRoof.id)?.asset).toEqual({
      id: roofId,
      name: 'Cubierta',
    });

    const filtered = await service.listByEstate(estate, manager, {
      pageSize: 100,
      assetId: roofId,
    });
    expect(filtered.items.length).toBeGreaterThan(0);
    expect(filtered.items.every((i) => i.assetId === roofId)).toBe(true);
    expect(filtered.items.some((i) => i.title === 'Del ascensor')).toBe(false);
  });

  it('filtrar por una instalación ajena no devuelve nada de otras fincas', async () => {
    const out = await service.listByEstate(estate, manager, {
      assetId: foreignAssetId,
    });
    expect(out.items).toEqual([]);
  });

  it('el detalle trae la instalación a la gestión y NO al propietario', async () => {
    const issue = await service.create(
      estate,
      dto({ assetId: roofId }),
      manager,
    );
    expect((await service.findById(issue.id, manager))?.asset).toEqual({
      id: roofId,
      name: 'Cubierta',
    });
    expect((await service.findById(issue.id, owner))?.asset).toBeUndefined();
  });

  it('el panel de instalaciones cuenta las incidencias activas de cada una', async () => {
    const issue = await service.create(
      estate,
      dto({ title: 'Para contar', assetId: liftId }),
      manager,
    );
    const before = await prisma.issue.count({
      where: {
        assetId: liftId,
        status: { in: ['Abierta', 'EnReparacion', 'PendienteProveedor'] },
      },
    });
    await service.updateStatus(
      issue.id,
      { status: 'Resuelta' } as never,
      manager,
    );
    const after = await prisma.issue.count({
      where: {
        assetId: liftId,
        status: { in: ['Abierta', 'EnReparacion', 'PendienteProveedor'] },
      },
    });
    expect(after).toBe(before - 1);
  });
});
