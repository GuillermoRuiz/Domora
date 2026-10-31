import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
import { EstateCommunityService } from './estate-community.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: el resumen de «Mi comunidad» que ve el
 * propietario solo lleva datos de presentación y tres indicadores agregados;
 * nunca nombres de otros propietarios, incidencias ni instalaciones.
 */
const prisma = createPrismaClient();
const service = new EstateCommunityService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
);

let admin: AdministratorFixture;
let otherAdmin: AdministratorFixture;
let estate: string;
let emptyEstate: string;
let otherEstate: string;
let p1: string;
let p2: string;
let p3: string;
let ownerA: string;
let ownerB: string;
let ownerRevoked: string;
let ownerNamesake: string;
const userIds: string[] = [];
let owner: AuthenticatedUser;

const asOwner = (userId: string, estateIds: string[]) =>
  ({
    id: userId,
    role: 'C',
    estateIds,
    administratorId: null,
  }) as unknown as AuthenticatedUser;
const member = (
  propertyId: string,
  userId: string,
  extra: Record<string, unknown> = {},
) =>
  prisma.propertyMembership.create({
    data: {
      propertyId,
      userId,
      roleType: 'Propietario',
      status: 'linked',
      linkedAt: new Date(),
      ...extra,
    } as never,
  });
let refSeq = 0;
const issue = (
  _propertyId: string,
  status: 'Abierta' | 'Resuelta',
  deletedAt: Date | null = null,
) =>
  prisma.issue.create({
    data: {
      ref: `COM-${Date.now()}-${++refSeq}`,
      estateId: estate,
      type: 'Fuga',
      title: 'Incidencia secreta de otro vecino',
      description: 'Contenido que el resto no debe ver',
      status,
      priority: 'Normal',
      source: 'Propietario',
      date: new Date(),
      deletedAt,
    },
  });

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (mi comunidad)',
  });
  otherAdmin = await createAdministrator(prisma, {
    name: 'Otra gestora (mi comunidad)',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Residencial Plaza (prueba)' },
  });
  emptyEstate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca vacía (mi comunidad)' },
  });
  otherEstate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Otra finca (mi comunidad)' },
  });
  await prisma.estate.update({
    where: { id: estate },
    data: {
      address: 'Calle Gran Vía',
      streetNumber: '12',
      postalCode: '28013',
      province: 'Madrid',
      location: 'Madrid',
      description: 'Comunidad tranquila.',
    },
  });
  p1 = await createProperty(prisma, estate, { ref: 'C1' });
  p2 = await createProperty(prisma, estate, { ref: 'C2' });
  p3 = await createProperty(prisma, estate, { ref: 'C3' });

  ownerA = await createOwnerUser(prisma, {
    fullName: 'Ana Titular (mi comunidad)',
  });
  ownerB = await createOwnerUser(prisma, {
    fullName: 'Beatriz Vecina (mi comunidad)',
  });
  ownerRevoked = await createOwnerUser(prisma, {
    fullName: 'Carla Revocada (mi comunidad)',
  });
  ownerNamesake = await createOwnerUser(prisma, {
    fullName: 'Ana Titular Importada (mi comunidad)',
  });
  userIds.push(ownerA, ownerB, ownerRevoked, ownerNamesake);
  owner = asOwner(ownerA, [estate]);

  await member(p1, ownerA);
  await member(p2, ownerB);
  await member(p3, ownerRevoked, { status: 'revoked', revokedAt: new Date() });
  // La misma persona (mismo NIF) como usuaria y como propietaria importada cuenta UNA vez.
  await prisma.user.update({
    where: { id: ownerA },
    data: { taxIdCountry: 'ES', taxId: '12345678Z' },
  });
  await prisma.externalOwner.create({
    data: {
      propertyId: p1,
      fullName: 'Ana Titular',
      taxIdCountry: 'ES',
      taxId: '12345678-Z',
      createdByUserId: ownerNamesake,
    },
  });
  // Un propietario importado distinto sí suma; uno ya promovido a usuario no (ya cuenta como usuario).
  await prisma.externalOwner.create({
    data: {
      propertyId: p3,
      fullName: 'Pedro Importado',
      createdByUserId: ownerNamesake,
    },
  });
  await prisma.externalOwner.create({
    data: {
      propertyId: p2,
      fullName: 'Beatriz Promovida',
      createdByUserId: ownerNamesake,
      promotedToUserId: ownerB,
    },
  });

  await issue(p1, 'Abierta');
  await issue(p2, 'Abierta'); // de OTRO vecino: cuenta, pero solo como número
  await issue(p3, 'Resuelta');
  await issue(p3, 'Abierta', new Date());
});

afterAll(async () => {
  await prisma.issue.deleteMany({
    where: { estateId: { in: [estate, emptyEstate, otherEstate] } },
  });
  await prisma.asset.deleteMany({
    where: { estateId: { in: [estate, emptyEstate, otherEstate] } },
  });
  await prisma.externalOwner.deleteMany({
    where: { propertyId: { in: [p1, p2, p3] } },
  });
  await prisma.propertyMembership.deleteMany({
    where: { propertyId: { in: [p1, p2, p3] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, otherAdmin.administratorId);
  await prisma.$disconnect();
});

describe('EstateCommunityService.getSummary', () => {
  it('devuelve los datos de presentación de la finca', async () => {
    const s = await service.getSummary(estate, owner);
    expect(s).toMatchObject({
      id: estate,
      name: 'Residencial Plaza (prueba)',
      address: 'Calle Gran Vía, 12',
      postalCode: '28013',
      location: 'Madrid',
      province: 'Madrid',
      description: 'Comunidad tranquila.',
      photoUpdatedAt: null,
    });
  });

  it('no expone datos internos de la finca (CIF, IBAN, claves, acreedor SEPA)', async () => {
    const s = (await service.getSummary(estate, owner)) as unknown as Record<
      string,
      unknown
    >;
    for (const key of [
      'cif',
      'iban',
      'creditorIban',
      'creditorId',
      'photoKey',
      'photoContentType',
      'administratorId',
      'reserveTarget',
    ]) {
      expect(s).not.toHaveProperty(key);
    }
  });

  it('cuenta propietarios distintos: la misma persona por NIF una vez, sin revocados ni importados ya promovidos', async () => {
    const { indicators } = await service.getSummary(estate, owner);
    // Ana (usuaria + importada con el mismo NIF) + Beatriz + Pedro importado = 3
    expect(indicators.owners).toBe(3);
  });

  it('cuenta las incidencias activas de TODA la comunidad (no resueltas ni borradas), solo como número', async () => {
    const s = await service.getSummary(estate, owner);
    expect(s.indicators.activeIssues).toBe(2);
    const json = JSON.stringify(s);
    expect(json).not.toContain('Incidencia secreta');
    expect(json).not.toContain('Contenido que el resto no debe ver');
  });

  it('no filtra el nombre de ningún propietario', async () => {
    const json = JSON.stringify(await service.getSummary(estate, owner));
    for (const name of ['Beatriz', 'Carla', 'Pedro', 'Ana Titular'])
      expect(json).not.toContain(name);
  });

  it('ignora las propiedades borradas: sus propietarios no cuentan (igual que el panel de gestión)', async () => {
    const before = (await service.getSummary(estate, owner)).indicators;
    const gone = await createProperty(prisma, estate, { ref: 'C9' });
    await prisma.property.update({
      where: { id: gone },
      data: { deletedAt: new Date() },
    });
    const extraOwner = await createOwnerUser(prisma, {
      fullName: 'Dolores Baja (mi comunidad)',
    });
    userIds.push(extraOwner);
    await member(gone, extraOwner);
    expect((await service.getSummary(estate, owner)).indicators).toEqual(
      before,
    );
    await prisma.propertyMembership.deleteMany({ where: { propertyId: gone } });
  });

  it('una finca sin propietarios ni incidencias devuelve ceros', async () => {
    const s = await service.getSummary(
      emptyEstate,
      asOwner(ownerA, [emptyEstate]),
    );
    expect(s.indicators).toEqual({
      owners: 0,
      activeIssues: 0,
      commonAreas: 'sin_datos',
    });
  });

  describe('zonas comunes: solo una etiqueta', () => {
    const asset = (
      name: string,
      operationalStatus: 'operativa' | 'en_mantenimiento' | 'fuera_de_servicio',
    ) =>
      prisma.asset.create({
        data: {
          estateId: estate,
          name,
          category: 'Ascensor',
          operationalStatus,
        },
      });

    it('«buen estado» si todo está operativo, «en mantenimiento» si hay alguna en obras y «requiere atención» si hay alguna fuera de servicio (manda sobre las demás)', async () => {
      await asset('Ascensor A', 'operativa');
      expect(
        (await service.getSummary(estate, owner)).indicators.commonAreas,
      ).toBe('buen_estado');
      await asset('Piscina', 'en_mantenimiento');
      expect(
        (await service.getSummary(estate, owner)).indicators.commonAreas,
      ).toBe('en_mantenimiento');
      await asset('Caldera', 'fuera_de_servicio');
      expect(
        (await service.getSummary(estate, owner)).indicators.commonAreas,
      ).toBe('requiere_atencion');
    });

    it('no expone ni los nombres ni la lista de instalaciones', async () => {
      const json = JSON.stringify(await service.getSummary(estate, owner));
      for (const name of ['Ascensor A', 'Piscina', 'Caldera'])
        expect(json).not.toContain(name);
    });
  });

  describe('acceso', () => {
    it('un propietario de otra finca no puede verla', async () => {
      await expect(
        service.getSummary(estate, asOwner(ownerB, [otherEstate])),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('un propietario sin ninguna propiedad vinculada tampoco', async () => {
      await expect(
        service.getSummary(estate, asOwner(ownerB, [])),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('la gestora de la finca sí, y otra gestora no', async () => {
      await expect(
        service.getSummary(estate, roleB(admin, [estate])),
      ).resolves.toBeDefined();
      await expect(
        service.getSummary(estate, roleB(otherAdmin, [])),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('una finca borrada da 404 aunque el token aún la lista', async () => {
      const gone = await createLedgerEstate(prisma, admin.administratorId, {
        estate: { name: 'Finca borrada (mi comunidad)' },
      });
      await prisma.estate.update({
        where: { id: gone },
        data: { deletedAt: new Date() },
      });
      await expect(
        service.getSummary(gone, asOwner(ownerA, [gone])),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
