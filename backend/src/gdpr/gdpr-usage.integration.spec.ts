import { PrismaService } from '../prisma/prisma.service';
import { createOwnerUser } from '../testing/db-fixtures';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsageRecorder } from '../usage/usage-recorder.service';
import { GdprService } from './gdpr.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: the daily usage log (`user_daily_activity`) is
 * personal data of the user, so the portability export includes it and the
 * self-erasure deletes it, like the document reads.
 */
const prisma = createPrismaClient();
const audit = { logAccess: jest.fn().mockResolvedValue(undefined) };
const service = new GdprService(prisma as unknown as PrismaService, audit as never);
const DAY = new Date('2001-05-02T00:00:00Z');
let userId: string;
let owner: AuthenticatedUser;

beforeAll(async () => {
  userId = await createOwnerUser(prisma);
  owner = { id: userId, role: 'C', estateIds: [], administratorId: null };
  await prisma.userDailyActivity.create({ data: { day: DAY, userId, role: 'C', modules: ['documents'], requests: 3 } });
});

afterAll(async () => {
  await prisma.userDailyActivity.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

it('exports the user daily usage with the rest of the personal data', async () => {
  const data = await service.exportMyData(owner);
  expect(data.dailyActivity).toEqual([expect.objectContaining({ userId, modules: ['documents'], requests: 3 })]);
});

it('deletes the user daily usage when the user erases the account', async () => {
  await service.eraseMyAccount(owner);
  expect(await prisma.userDailyActivity.count({ where: { userId } })).toBe(0);
});

it('usage still buffered when a user erases the account is not written after it', async () => {
  const erasedId = await createOwnerUser(prisma);
  try {
    const recorder = new UsageRecorder(prisma as unknown as PrismaService);
    recorder.record({ userId: erasedId, role: 'C', administratorId: null, module: 'gdpr', at: DAY });
    await service.eraseMyAccount({ id: erasedId, role: 'C', estateIds: [], administratorId: null });

    await expect(recorder.flush()).resolves.toEqual({ written: 0, failed: 0 });
    expect(await prisma.userDailyActivity.count({ where: { userId: erasedId } })).toBe(0);
  } finally {
    await prisma.userDailyActivity.deleteMany({ where: { userId: erasedId } });
    await prisma.user.deleteMany({ where: { id: erasedId } });
  }
});
