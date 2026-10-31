import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  createAdministrator,
  createEstate,
  createProperty,
} from '../testing/db-fixtures';
import { EstateGovernanceService } from './estate-governance.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** Own unique fixtures only; requires a migrated disposable PostgreSQL DB. */
describe('office terms PostgreSQL guarantees', () => {
  const db = createPrismaClient();
  const service = new EstateGovernanceService(db as PrismaService);
  let estateId: string, foreignEstateId: string, propertyId: string;
  let ownerA: string, ownerB: string;
  let actor: AuthenticatedUser;
  const adminIds: string[] = [];
  const userIds: string[] = [];
  beforeAll(async () => {
    for (let index = 0; index < 2; index++) {
      const fixture = await createAdministrator(db);
      adminIds.push(fixture.administratorId);
      userIds.push(fixture.userId);
    }
    estateId = await createEstate(db, adminIds[0]);
    foreignEstateId = await createEstate(db, adminIds[1]);
    propertyId = await createProperty(db, estateId);
    await db.propertyMembership.create({
      data: {
        propertyId,
        userId: userIds[0],
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    ownerA = (
      await db.externalOwner.create({
        data: {
          propertyId,
          fullName: 'Ana Vice',
          roleType: 'Propietario',
          createdByUserId: userIds[0],
        },
      })
    ).id;
    ownerB = (
      await db.externalOwner.create({
        data: {
          propertyId,
          fullName: 'Blas Vice',
          roleType: 'Propietario',
          createdByUserId: userIds[0],
        },
      })
    ).id;
    // Deliberately forged/stale claims: real DB relationships must win.
    actor = {
      id: userIds[0],
      role: 'B',
      administratorId: adminIds[1],
      estateIds: [estateId, foreignEstateId],
    };
  }, 30000);
  afterEach(async () => {
    await db.estateOfficeTerm.deleteMany({ where: { estateId } });
  });
  afterAll(async () => {
    await db.estateOfficeTerm.deleteMany({
      where: { estateId: { in: [estateId, foreignEstateId].filter(Boolean) } },
    });
    await db.propertyMembership.deleteMany({
      where: { userId: { in: userIds } },
    });
    await db.externalOwner.deleteMany({ where: { propertyId } });
    if (propertyId) await db.property.delete({ where: { id: propertyId } });
    await db.estate.deleteMany({
      where: { administratorId: { in: adminIds } },
    });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.administrator.deleteMany({ where: { id: { in: adminIds } } });
    await db.$disconnect();
  });
  it('replaces the president atomically and preserves the authoritative name snapshot', async () => {
    const first = await service.appoint(
      estateId,
      {
        propertyId,
        userId: userIds[0],
        holderNameSnapshot: 'Ignored spoofed name',
        startsAt: '2025-01-01',
      },
      actor,
    );
    expect(first.holderNameSnapshot).toBe('Gestor de prueba');
    await db.user.update({
      where: { id: userIds[0] },
      data: { fullName: 'Nombre cambiado' },
    });
    await service.appoint(
      estateId,
      { startsAt: '2026-01-01', holderNameSnapshot: 'Sucesor' },
      actor,
    );
    const history = await service.list(estateId, actor);
    expect(history).toHaveLength(2);
    expect(history[0].holderNameSnapshot).toBe('Sucesor');
    expect(history[1].endsAt?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(history[1].holderNameSnapshot).toBe('Gestor de prueba');
  });
  it('database rejects simultaneous open terms, finite overlaps, and invalid dates', async () => {
    const data = {
      estateId,
      holderNameSnapshot: 'Presidente',
      createdByUserId: userIds[0],
      startsAt: new Date('2026-01-01'),
    };
    await db.estateOfficeTerm.create({ data });
    // Catch expected SQL errors inside PostgreSQL. This also works with local
    // PGlite wire adapters which cannot recover a prepared connection after
    // an ErrorResponse; the assertions still exercise the real constraints.
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('domora.test_estate', ${estateId}, true), set_config('domora.test_actor', ${userIds[0]}, true)`;
      await tx.$executeRawUnsafe(`DO $$ BEGIN
        BEGIN
          INSERT INTO estate_office_terms (id, estate_id, holder_name_snapshot, starts_at, ends_at, created_by_user_id, updated_at)
          VALUES (gen_random_uuid(), current_setting('domora.test_estate')::uuid, 'Overlap', '2026-05-01', '2026-08-01', current_setting('domora.test_actor')::uuid, now());
          RAISE EXCEPTION 'Overlap was accepted';
        EXCEPTION WHEN exclusion_violation THEN NULL; END;
        BEGIN
          INSERT INTO estate_office_terms (id, estate_id, holder_name_snapshot, starts_at, ends_at, created_by_user_id, updated_at)
          VALUES (gen_random_uuid(), current_setting('domora.test_estate')::uuid, 'Invalid period', '2025-01-01', '2025-01-01', current_setting('domora.test_actor')::uuid, now());
          RAISE EXCEPTION 'Invalid period was accepted';
        EXCEPTION WHEN check_violation THEN NULL; END;
      END $$;`);
    });
    expect(await db.estateOfficeTerm.count({ where: { estateId } })).toBe(1);
  });
  it('rejects cross-tenant reads and mutations despite a foreign estate in JWT', async () => {
    await expect(service.list(foreignEstateId, actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.appoint(
        foreignEstateId,
        { startsAt: '2026-01-01', holderNameSnapshot: 'Forbidden' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      await db.estateOfficeTerm.count({ where: { estateId: foreignEstateId } }),
    ).toBe(0);
  });
  it('isolates a referenced property and owner to the authorized estate', async () => {
    const foreignProperty = await createProperty(db, foreignEstateId);
    try {
      await expect(
        service.appoint(
          estateId,
          {
            startsAt: '2026-01-01',
            holderNameSnapshot: 'Attempt',
            propertyId: foreignProperty,
          },
          actor,
        ),
      ).rejects.toThrow('Propiedad ajena');
      await expect(
        service.appoint(
          estateId,
          { startsAt: '2026-01-01', userId: userIds[1] },
          actor,
        ),
      ).rejects.toThrow('titular no pertenece');
    } finally {
      await db.property.delete({ where: { id: foreignProperty } });
    }
  });
  it('keeps several vice-presidents at once: appointing one never ends the others', async () => {
    await service.appoint(
      estateId,
      {
        role: 'VICE_PRESIDENT',
        externalOwnerId: ownerA,
        startsAt: '2026-01-01',
      },
      actor,
    );
    await service.appoint(
      estateId,
      {
        role: 'VICE_PRESIDENT',
        externalOwnerId: ownerB,
        startsAt: '2026-02-01',
      },
      actor,
    );
    const terms = await db.estateOfficeTerm.findMany({
      where: { estateId },
      orderBy: { startsAt: 'asc' },
    });
    expect(terms.map((t) => [t.role, t.holderNameSnapshot, t.endsAt])).toEqual([
      ['VICE_PRESIDENT', 'Ana Vice', null],
      ['VICE_PRESIDENT', 'Blas Vice', null],
    ]);
  });
  it('promoting a vice-president to president ends the vice-presidency on that date and the previous presidency', async () => {
    await service.appoint(
      estateId,
      { startsAt: '2025-01-01', holderNameSnapshot: 'Presidente anterior' },
      actor,
    );
    await service.appoint(
      estateId,
      {
        role: 'VICE_PRESIDENT',
        externalOwnerId: ownerA,
        startsAt: '2025-01-01',
      },
      actor,
    );
    await service.appoint(
      estateId,
      { role: 'PRESIDENT', externalOwnerId: ownerA, startsAt: '2026-03-01' },
      actor,
    );
    const terms = await db.estateOfficeTerm.findMany({
      where: { estateId },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }],
    });
    const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
    expect(
      terms.map((t) => [
        t.role,
        t.holderNameSnapshot,
        day(t.startsAt),
        day(t.endsAt),
      ]),
    ).toEqual([
      ['PRESIDENT', 'Presidente anterior', '2025-01-01', '2026-03-01'],
      ['VICE_PRESIDENT', 'Ana Vice', '2025-01-01', '2026-03-01'],
      ['PRESIDENT', 'Ana Vice', '2026-03-01', null],
    ]);
  });
  it('rejects a second office for the same holder: no repeated vice-presidency and no president as vice-president', async () => {
    await service.appoint(
      estateId,
      {
        role: 'VICE_PRESIDENT',
        externalOwnerId: ownerA,
        startsAt: '2026-01-01',
      },
      actor,
    );
    await expect(
      service.appoint(
        estateId,
        {
          role: 'VICE_PRESIDENT',
          externalOwnerId: ownerA,
          startsAt: '2026-02-01',
        },
        actor,
      ),
    ).rejects.toThrow('ya es vicepresidente');
    await service.appoint(
      estateId,
      { externalOwnerId: ownerB, startsAt: '2026-01-01' },
      actor,
    );
    await expect(
      service.appoint(
        estateId,
        {
          role: 'VICE_PRESIDENT',
          externalOwnerId: ownerB,
          startsAt: '2026-02-01',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.estateOfficeTerm.count({ where: { estateId } })).toBe(2);
  });
  it('database rejects overlapping offices of the same holder across roles', async () => {
    await db.estateOfficeTerm.create({
      data: {
        estateId,
        role: 'VICE_PRESIDENT',
        externalOwnerId: ownerA,
        holderNameSnapshot: 'Ana Vice',
        createdByUserId: userIds[0],
        startsAt: new Date('2026-01-01'),
      },
    });
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('domora.test_estate', ${estateId}, true), set_config('domora.test_actor', ${userIds[0]}, true), set_config('domora.test_owner', ${ownerA}, true)`;
      await tx.$executeRawUnsafe(`DO $$ BEGIN
        BEGIN
          INSERT INTO estate_office_terms (id, estate_id, role, external_owner_id, holder_name_snapshot, starts_at, created_by_user_id, updated_at)
          VALUES (gen_random_uuid(), current_setting('domora.test_estate')::uuid, 'PRESIDENT', current_setting('domora.test_owner')::uuid, 'Ana Vice', '2026-05-01', current_setting('domora.test_actor')::uuid, now());
          RAISE EXCEPTION 'Same holder overlap was accepted';
        EXCEPTION WHEN exclusion_violation THEN NULL; END;
      END $$;`);
    });
    expect(await db.estateOfficeTerm.count({ where: { estateId } })).toBe(1);
  });
  it('a backdated office that overlaps the same holder later in time is a 409, not a server error', async () => {
    await service.appoint(
      estateId,
      { externalOwnerId: ownerA, startsAt: '2025-01-01' },
      actor,
    );
    await expect(
      service.appoint(
        estateId,
        {
          role: 'VICE_PRESIDENT',
          externalOwnerId: ownerA,
          startsAt: '2024-06-01',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await db.estateOfficeTerm.count({ where: { estateId } })).toBe(1);
  });
});
