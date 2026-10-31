import { type DocumentVisibility } from '../prisma/client';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { DocumentAccessService } from './document-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ResourcesService } from '../resources/resources.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/** Own unique fixtures only; requires a migrated disposable PostgreSQL DB. */
describe('DocumentAccessService — who sees which document (PostgreSQL)', () => {
  const db = createPrismaClient();
  const access = new DocumentAccessService(db as unknown as PrismaService);
  let fx: AdministratorFixture, other: AdministratorFixture;
  let estateId: string,
    otherEstateId: string,
    p1: string,
    p2: string,
    pOther: string;
  const users: Record<
    'owner1' | 'tenant1' | 'owner2' | 'board' | 'foreignOwner',
    string
  > = {} as never;
  const docs: Record<string, string> = {};

  const asC = (id: string, estateIds: string[]): AuthenticatedUser => ({
    id,
    role: 'C',
    estateIds,
    administratorId: null,
  });

  beforeAll(async () => {
    fx = await createAdministrator(db);
    other = await createAdministrator(db);
    estateId = await createEstate(db, fx.administratorId);
    otherEstateId = await createEstate(db, other.administratorId);
    p1 = await createProperty(db, estateId, { ref: '1A' });
    p2 = await createProperty(db, estateId, { ref: '2B' });
    pOther = await createProperty(db, otherEstateId, { ref: 'X1' });
    for (const key of Object.keys({
      owner1: 0,
      tenant1: 0,
      owner2: 0,
      board: 0,
      foreignOwner: 0,
    }) as (keyof typeof users)[]) {
      users[key] = await createOwnerUser(db, { fullName: key });
    }
    const link = (
      userId: string,
      propertyId: string,
      roleType: 'Propietario' | 'Inquilino' | 'Representante',
    ) =>
      db.propertyMembership.create({
        data: {
          userId,
          propertyId,
          roleType,
          status: 'linked',
          linkedAt: new Date(),
        },
      });
    await link(users.owner1, p1, 'Propietario');
    await link(users.tenant1, p1, 'Inquilino');
    await link(users.owner2, p2, 'Representante');
    await link(users.board, p2, 'Propietario');
    await link(users.foreignOwner, pOther, 'Propietario');
    await db.estateOfficeTerm.create({
      data: {
        estateId,
        role: 'PRESIDENT',
        userId: users.board,
        propertyId: p2,
        holderNameSnapshot: 'board',
        startsAt: new Date('2024-01-01'),
        createdByUserId: fx.userId,
      },
    });

    const doc = async (
      key: string,
      effectiveVisibility: DocumentVisibility,
      extra: Record<string, unknown> = {},
      estate = estateId,
    ) => {
      docs[key] = (
        await db.document.create({
          data: {
            estateId: estate,
            title: key,
            type: 'Otro',
            date: new Date(),
            size: '1 KB',
            effectiveVisibility,
            ...extra,
          } as never,
        })
      ).id;
    };
    await doc('manager', 'MANAGER');
    await doc('board', 'BOARD');
    await doc('owners', 'OWNERS');
    await doc('property1', 'PROPERTY', {
      targetPropertyId: p1,
      visibility: 'PROPERTY',
    });
    await doc('property2', 'PROPERTY', {
      targetPropertyId: p2,
      visibility: 'PROPERTY',
    });
    await doc('ownersDeleted', 'OWNERS', { deletedAt: new Date() });
    await doc('foreignOwners', 'OWNERS', {}, otherEstateId);
  }, 30000);

  afterAll(async () => {
    await db.document.deleteMany({
      where: { estateId: { in: [estateId, otherEstateId] } },
    });
    await db.estateOfficeTerm.deleteMany({ where: { estateId } });
    await db.propertyMembership.deleteMany({
      where: { userId: { in: Object.values(users) } },
    });
    await db.property.deleteMany({ where: { id: { in: [p1, p2, pOther] } } });
    await db.estate.deleteMany({
      where: { id: { in: [estateId, otherEstateId] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [...Object.values(users), fx.userId, other.userId] } },
    });
    await db.administrator.deleteMany({
      where: { id: { in: [fx.administratorId, other.administratorId] } },
    });
    await db.$disconnect();
  });

  async function visibleTitles(user: AuthenticatedUser): Promise<string[]> {
    const where = await access.visibleWhere(user);
    const rows = await db.document.findMany({
      where: { AND: [where, { estateId: { in: [estateId, otherEstateId] } }] },
      select: { title: true },
    });
    return rows.map((r) => r.title).sort();
  }

  it('the manager sees every live document of their estates, including «Solo gestora», and nothing of another manager', async () => {
    expect(await visibleTitles(roleB(fx, [estateId]))).toEqual(
      ['board', 'manager', 'owners', 'property1', 'property2'].sort(),
    );
    // A forged estate claim does not open another manager's estate.
    expect(
      await visibleTitles(roleB(fx, [estateId, otherEstateId])),
    ).not.toContain('foreignOwners');
  });

  it('a deleted or demoted user sees nothing despite a valid token', async () => {
    expect(
      await visibleTitles({
        id: '00000000-0000-0000-0000-000000000000',
        role: 'B',
        estateIds: [estateId],
        administratorId: fx.administratorId,
      }),
    ).toEqual([]);
  });

  it('an owner sees «Todos los propietarios» of their estate and their own property, never «Solo gestora» nor «Junta»', async () => {
    expect(await visibleTitles(asC(users.owner1, [estateId]))).toEqual([
      'owners',
      'property1',
    ]);
  });

  it('a representative counts as an owner of their property', async () => {
    expect(await visibleTitles(asC(users.owner2, [estateId]))).toEqual([
      'owners',
      'property2',
    ]);
  });

  it('a tenant sees nothing (D1: no tenants), not even documents of their property', async () => {
    expect(await visibleTitles(asC(users.tenant1, [estateId]))).toEqual([]);
  });

  it('a member of the board also sees «Junta de gobierno»', async () => {
    expect(await visibleTitles(asC(users.board, [estateId]))).toEqual([
      'board',
      'owners',
      'property2',
    ]);
  });

  it('a board member whose office ended no longer sees «Junta»', async () => {
    await db.estateOfficeTerm.updateMany({
      where: { estateId, userId: users.board },
      data: { endsAt: new Date(Date.now() - 86400000) },
    });
    try {
      expect(await visibleTitles(asC(users.board, [estateId]))).toEqual([
        'owners',
        'property2',
      ]);
    } finally {
      await db.estateOfficeTerm.updateMany({
        where: { estateId, userId: users.board },
        data: { endsAt: null },
      });
    }
  });

  it('an owner of another estate sees only their estate, even with a forged estate claim', async () => {
    expect(
      await visibleTitles(asC(users.foreignOwner, [estateId, otherEstateId])),
    ).toEqual(['foreignOwners']);
  });

  it('the legacy document list gives an owner only the public fields, never visibility internals or storage keys', async () => {
    const resources = new ResourcesService(
      db as never,
      new EstateAccessService(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const page = await resources.listDocuments(
      estateId,
      asC(users.owner1, [estateId]),
    );
    expect(page.items.map((d) => d.title).sort()).toEqual([
      'owners',
      'property1',
    ]);
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'date',
          'description',
          'estateId',
          'folderId',
          'folderName',
          'id',
          'isNew',
          'mimeType',
          'size',
          'sizeBytes',
          'source',
          'targetPropertyId',
          'title',
          'type',
          'updatedAt',
        ].sort(),
      );
    }
  });

  it('a document created through the legacy endpoint stores the type of its file', async () => {
    const stubs = {
      storage: { assertDocumentKey: () => undefined },
      auth: { resolve: async () => ({}) },
    };
    const resources = new ResourcesService(
      db as never,
      new EstateAccessService(),
      {} as never,
      stubs.storage as never,
      {} as never,
      stubs.auth as never,
    );
    const manager: AuthenticatedUser = {
      id: fx.userId,
      role: 'B',
      estateIds: [estateId],
      administratorId: fx.administratorId,
    };
    const created = await resources.createDocument(
      estateId,
      {
        title: 'Póliza',
        type: 'Otro',
        date: '2026-01-01',
        size: '1 KB',
        s3Key: `documents/${estateId}/x-Poliza.pdf`,
      } as never,
      manager,
    );
    expect(created.mimeType).toBe('application/pdf');
    await db.document.delete({ where: { id: created.id } });
  });

  it('a revoked membership stops granting access', async () => {
    await db.propertyMembership.updateMany({
      where: { userId: users.owner1 },
      data: { status: 'revoked', revokedAt: new Date() },
    });
    try {
      expect(await visibleTitles(asC(users.owner1, [estateId]))).toEqual([]);
    } finally {
      await db.propertyMembership.updateMany({
        where: { userId: users.owner1 },
        data: { status: 'linked', revokedAt: null },
      });
    }
  });
});
