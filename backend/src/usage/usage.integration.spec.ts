import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createAdministrator, purgeAdministrator } from '../testing/db-fixtures';
import { UsageRecorder } from './usage-recorder.service';
import { UsageService } from './usage.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Against real Postgres: the raw `INSERT ... ON CONFLICT` upsert (enum and
 * array casts, module union, request sum) and the summary query. Uses days of
 * 2001 so it never touches real usage rows in a shared database; the cascade
 * from `purgeAdministrator` deleting the user removes the rows.
 */
const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const DAY = new Date('2001-05-10T09:00:00Z');
let administratorId: string;
let userId: string;

beforeAll(async () => {
  ({ administratorId, userId } = await createAdministrator(prisma));
});

afterAll(async () => {
  await prisma.userDailyActivity.deleteMany({ where: { userId } });
  await purgeAdministrator(prisma, administratorId);
  expect(await prisma.userDailyActivity.count({ where: { userId } })).toBe(0);
  await prisma.$disconnect();
});

it('two flushes for the same user and day merge modules and add requests', async () => {
  const recorder = new UsageRecorder(db);
  recorder.record({ userId, role: 'B', administratorId, module: 'receipts', at: DAY });
  recorder.record({ userId, role: 'B', administratorId, module: 'estates', at: DAY });
  await expect(recorder.flush()).resolves.toEqual({ written: 1, failed: 0 });

  recorder.record({ userId, role: 'B', administratorId, module: 'estates', at: DAY });
  recorder.record({ userId, role: 'B', administratorId, module: 'meetings', at: DAY });
  recorder.record({ userId, role: 'B', administratorId, module: 'meetings', at: DAY });
  await expect(recorder.flush()).resolves.toEqual({ written: 1, failed: 0 });

  const rows = await prisma.userDailyActivity.findMany({ where: { userId } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    day: new Date('2001-05-10T00:00:00Z'),
    role: 'B',
    administratorId,
    modules: ['estates', 'meetings', 'receipts'],
    requests: 5,
  });

  const summary = await new UsageService(db).summary(new Date('2001-05-09'), new Date('2001-05-10'));
  expect(summary.days).toEqual([
    { day: '2001-05-09', activeUsers: 0, activeB: 0, activeC: 0, requests: 0 },
    { day: '2001-05-10', activeUsers: 1, activeB: 1, activeC: 0, requests: 5 },
  ]);
  expect(summary.despachos.find((d) => d.administratorId === administratorId)).toMatchObject({
    activeUsers: 1,
    activeDays: 1,
    requests: 5,
    lastActiveDay: '2001-05-10',
  });
});

it('usage of a user that no longer exists is skipped without an error', async () => {
  const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  const recorder = new UsageRecorder(db);
  const ghost = '00000000-0000-4000-8000-000000000000';
  recorder.record({ userId: ghost, role: 'C', administratorId: null, module: 'documents', at: DAY });
  await expect(recorder.flush()).resolves.toEqual({ written: 0, failed: 0 });
  expect(error).not.toHaveBeenCalled();
  expect(await prisma.userDailyActivity.count({ where: { userId: ghost } })).toBe(0);
  error.mockRestore();
});
