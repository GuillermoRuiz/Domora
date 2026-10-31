import { ConfigService } from '@nestjs/config';
import {
  createAdministrator,
  createEstate,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { EstateGeoService } from './estate-geo.service';
import type { PrismaService } from '../prisma/prisma.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** Own unique fixtures only; requires a migrated disposable PostgreSQL DB. No network: `locate` is stubbed. */
describe('EstateGeoService.refreshEstate (PostgreSQL)', () => {
  const db = createPrismaClient();
  const geo = new EstateGeoService(
    { get: () => undefined } as unknown as ConfigService,
    db as unknown as PrismaService,
  );
  let fx: AdministratorFixture;
  let estateId: string;

  beforeAll(async () => {
    fx = await createAdministrator(db);
    estateId = await createEstate(db, fx.administratorId, {
      cadastralReference: '9872023VH5797S',
    });
  });
  afterAll(async () => {
    await db.estate.deleteMany({ where: { id: estateId } });
    await db.user.deleteMany({ where: { id: fx.userId } });
    await db.administrator.deleteMany({ where: { id: fx.administratorId } });
    await db.$disconnect();
  });

  it('stores coordinates, source, attempt time and the Catastro parcel area', async () => {
    jest.spyOn(geo, 'locate').mockResolvedValueOnce({
      latitude: 38.640143,
      longitude: -3.463284,
      source: 'catastro',
      parcelAreaM2: 397,
    });
    await geo.refreshEstate(estateId);
    const row = await db.estate.findUniqueOrThrow({ where: { id: estateId } });
    expect([
      Number(row.latitude),
      Number(row.longitude),
      row.geoSource,
      Number(row.parcelAreaM2),
    ]).toEqual([38.640143, -3.463284, 'catastro', 397]);
    expect(row.geoResolvedAt).toBeInstanceOf(Date);
  });

  it('a failed lookup clears the location but records the attempt (no retry on every read)', async () => {
    jest.spyOn(geo, 'locate').mockResolvedValueOnce(null);
    await geo.refreshEstate(estateId);
    const row = await db.estate.findUniqueOrThrow({ where: { id: estateId } });
    expect([row.latitude, row.longitude, row.geoSource]).toEqual([
      null,
      null,
      null,
    ]);
    expect(row.geoResolvedAt).toBeInstanceOf(Date);
  });

  it('never overwrites an estate whose address changed while it was being located', async () => {
    await db.estate.update({
      where: { id: estateId },
      data: {
        latitude: null,
        longitude: null,
        geoSource: null,
        geoResolvedAt: null,
      },
    });
    jest.spyOn(geo, 'locate').mockImplementationOnce(async () => {
      await db.estate.update({
        where: { id: estateId },
        data: { address: 'Calle Nueva 9' },
      });
      return {
        latitude: 40.42,
        longitude: -3.705,
        source: 'nominatim',
        parcelAreaM2: null,
      };
    });
    await geo.refreshEstate(estateId);
    const row = await db.estate.findUniqueOrThrow({ where: { id: estateId } });
    expect([row.latitude, row.geoSource, row.geoResolvedAt]).toEqual([
      null,
      null,
      null,
    ]);
  });
});
