import { randomUUID } from 'node:crypto';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { ResourcesService } from './resources.service';
import { ResourceReadsController } from './resources.controller';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * `POST /resource-reads`: a document read marker is only written for a document the user can see
 * (odd/tasks/owner-documents.md). Own unique fixtures only; requires a migrated disposable PostgreSQL DB.
 */
describe('POST /resource-reads — document markers follow the visibility rule (PostgreSQL)', () => {
  const db = createPrismaClient();
  const service = new ResourcesService(
    db as never,
    new EstateAccessService(),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const controller = new ResourceReadsController(service);
  let fx: AdministratorFixture;
  let estateId: string, p1: string, p2: string, ownerId: string;
  let owner: AuthenticatedUser;
  const docs: Record<'mine' | 'neighbour' | 'manager', string> = {} as never;
  const reads = (userId: string) =>
    db.resourceRead.findMany({
      where: { userId },
      select: { sourceType: true, sourceId: true },
    });

  beforeAll(async () => {
    fx = await createAdministrator(db);
    estateId = await createEstate(db, fx.administratorId);
    p1 = await createProperty(db, estateId, { ref: '1A' });
    p2 = await createProperty(db, estateId, { ref: '2B' });
    ownerId = await createOwnerUser(db);
    await db.propertyMembership.create({
      data: {
        userId: ownerId,
        propertyId: p1,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    owner = {
      id: ownerId,
      role: 'C',
      estateIds: [estateId],
      administratorId: null,
    };
    const doc = async (title: string, data: Record<string, unknown>) =>
      (
        await db.document.create({
          data: {
            estateId,
            title,
            type: 'Otro',
            date: new Date(),
            size: '1 KB',
            ...data,
          } as never,
        })
      ).id;
    docs.mine = await doc('Carta 1A', {
      effectiveVisibility: 'PROPERTY',
      visibility: 'PROPERTY',
      targetPropertyId: p1,
    });
    docs.neighbour = await doc('Carta 2B', {
      effectiveVisibility: 'PROPERTY',
      visibility: 'PROPERTY',
      targetPropertyId: p2,
    });
    docs.manager = await doc('Solo gestora', {
      effectiveVisibility: 'MANAGER',
    });
  }, 30000);

  afterAll(async () => {
    await db.resourceRead.deleteMany({
      where: { userId: { in: [ownerId, fx.userId] } },
    });
    await db.document.deleteMany({ where: { estateId } });
    await db.propertyMembership.deleteMany({ where: { userId: ownerId } });
    await db.property.deleteMany({ where: { estateId } });
    await db.estate.deleteMany({ where: { id: estateId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, fx.userId] } } });
    await db.administrator.deleteMany({ where: { id: fx.administratorId } });
    await db.$disconnect();
  });

  afterEach(() =>
    db.resourceRead.deleteMany({
      where: { userId: { in: [ownerId, fx.userId] } },
    }),
  );

  it('an owner marks a document they can see', async () => {
    await controller.markRead(
      { sourceType: 'document', sourceId: docs.mine },
      owner,
    );
    expect(await reads(ownerId)).toEqual([
      { sourceType: 'document', sourceId: docs.mine },
    ]);
  });

  it.each([
    ['addressed to a neighbour', 'neighbour'],
    ['«Solo gestora»', 'manager'],
  ] as const)(
    'a document %s is ignored silently: no marker is written',
    async (_case, key) => {
      await expect(
        controller.markRead(
          { sourceType: 'document', sourceId: docs[key] },
          owner,
        ),
      ).resolves.toBeNull();
      expect(await reads(ownerId)).toEqual([]);
    },
  );

  it('an unknown document id is ignored the same way', async () => {
    await expect(
      controller.markRead(
        { sourceType: 'document', sourceId: randomUUID() },
        owner,
      ),
    ).resolves.toBeNull();
    expect(await reads(ownerId)).toEqual([]);
  });

  it('other resource types keep marking as before (existing behaviour)', async () => {
    const communicationId = randomUUID();
    await controller.markRead(
      { sourceType: 'communication', sourceId: communicationId },
      owner,
    );
    expect(await reads(ownerId)).toEqual([
      { sourceType: 'communication', sourceId: communicationId },
    ]);
  });

  it('the manager still marks documents of their estate', async () => {
    await controller.markRead(
      { sourceType: 'document', sourceId: docs.manager },
      roleB(fx, [estateId]),
    );
    expect(await reads(fx.userId)).toEqual([
      { sourceType: 'document', sourceId: docs.manager },
    ]);
  });
});
