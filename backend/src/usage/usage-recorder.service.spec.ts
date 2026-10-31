import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsageRecorder } from './usage-recorder.service';

/** Captures what each `$executeRaw` upsert receives (tagged template values). */
type Upsert = {
  day: string;
  userId: string;
  role: string;
  administratorId: string | null;
  modules: string[];
  requests: number;
};

function fakePrisma() {
  const upserts: Upsert[] = [];
  const executeRaw = jest.fn(
    (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const [day, userId, role, administratorId, modules, requests] =
        values as [string, string, string, string | null, string[], number];
      upserts.push({ day, userId, role, administratorId, modules, requests });
      return Promise.resolve(1);
    },
  );
  return {
    prisma: { $executeRaw: executeRaw } as unknown as PrismaService,
    executeRaw,
    upserts,
  };
}

const MORNING = new Date('2026-10-25T08:00:00Z');
const EVENING = new Date('2026-10-25T21:00:00Z');
const NEXT_DAY = new Date('2026-10-26T00:30:00Z');

describe('UsageRecorder', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('does not touch the database per request: one upsert per user and day on flush', async () => {
    const { prisma, executeRaw, upserts } = fakePrisma();
    const recorder = new UsageRecorder(prisma);

    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'receipts',
      at: EVENING,
    });
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: EVENING,
    });
    recorder.record({
      userId: 'u2',
      role: 'C',
      administratorId: null,
      module: 'documents',
      at: MORNING,
    });
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'meetings',
      at: NEXT_DAY,
    });
    expect(executeRaw).not.toHaveBeenCalled();

    await expect(recorder.flush()).resolves.toEqual({ written: 3, failed: 0 });
    expect(upserts).toEqual(
      expect.arrayContaining([
        {
          day: '2026-10-25',
          userId: 'u1',
          role: 'B',
          administratorId: 'adm1',
          modules: ['estates', 'receipts'],
          requests: 3,
        },
        {
          day: '2026-10-25',
          userId: 'u2',
          role: 'C',
          administratorId: null,
          modules: ['documents'],
          requests: 1,
        },
        {
          day: '2026-10-26',
          userId: 'u1',
          role: 'B',
          administratorId: 'adm1',
          modules: ['meetings'],
          requests: 1,
        },
      ]),
    );
    expect(upserts).toHaveLength(3);
  });

  it('merges modules and adds requests in the database (array union in ON CONFLICT)', async () => {
    const { prisma, executeRaw } = fakePrisma();
    const recorder = new UsageRecorder(prisma);
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    await recorder.flush();

    const sql = (executeRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toMatch(/ON CONFLICT \(day, user_id\) DO UPDATE/);
    expect(sql).toMatch(
      /requests = user_daily_activity\.requests \+ EXCLUDED\.requests/,
    );
    expect(sql).toMatch(
      /unnest\(user_daily_activity\.modules \|\| EXCLUDED\.modules\)/,
    );
    expect(sql).toMatch(
      /WHERE EXISTS \(SELECT 1 FROM users WHERE id = \?::uuid AND deleted_at IS NULL\)/,
    );
  });

  it('empties the buffer after a flush: a second flush writes nothing', async () => {
    const { prisma, executeRaw } = fakePrisma();
    const recorder = new UsageRecorder(prisma);
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    await recorder.flush();
    await expect(recorder.flush()).resolves.toEqual({ written: 0, failed: 0 });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it('a failing upsert is logged, never thrown, and does not stop the other users', async () => {
    const { prisma, executeRaw, upserts } = fakePrisma();
    const ok = executeRaw.getMockImplementation()!;
    executeRaw.mockImplementationOnce(() =>
      Promise.reject(new Error('db down')),
    );
    executeRaw.mockImplementation(ok);
    const error = jest.spyOn(Logger.prototype, 'error');
    const recorder = new UsageRecorder(prisma);
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    recorder.record({
      userId: 'u2',
      role: 'C',
      administratorId: null,
      module: 'documents',
      at: MORNING,
    });

    await expect(recorder.flush()).resolves.toEqual({ written: 1, failed: 1 });
    expect(upserts.map((u) => u.userId)).toEqual(['u2']);
    expect(error).toHaveBeenCalled();
  });

  it('keeps the buffer bounded: new user-days beyond the limit are dropped, known ones still count', async () => {
    const { prisma, upserts } = fakePrisma();
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const recorder = new UsageRecorder(prisma, { maxEntries: 2 });
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    recorder.record({
      userId: 'u2',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    recorder.record({
      userId: 'u3',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'receipts',
      at: MORNING,
    });

    await recorder.flush();
    expect(upserts.map((u) => u.userId).sort()).toEqual(['u1', 'u2']);
    expect(upserts.find((u) => u.userId === 'u1')).toMatchObject({
      modules: ['estates', 'receipts'],
      requests: 2,
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('flushes what is left when the module is destroyed', async () => {
    const { prisma, upserts } = fakePrisma();
    const recorder = new UsageRecorder(prisma);
    recorder.onModuleInit();
    recorder.record({
      userId: 'u1',
      role: 'B',
      administratorId: 'adm1',
      module: 'estates',
      at: MORNING,
    });
    await recorder.onModuleDestroy();
    expect(upserts).toHaveLength(1);
  });
});
