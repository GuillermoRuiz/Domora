import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReportSnapshotService } from './report-snapshot.service';
import type { ReportInput, ReportResult, ReportScope } from './reporting.types';

// This unit suite supplies an in-memory persistence boundary. The actual
// Prisma client/schema is covered by the reporting API integration suite.
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));

describe('ReportSnapshotService', () => {
  let saved: any;
  const prisma: any = {
    reportSnapshot: {
      create: jest.fn(async ({ data }: any) => {
        saved = structuredClone(data);
        return saved;
      }),
      findUnique: jest.fn(async () => saved),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
  };
  const service = new ReportSnapshotService(prisma);
  const scope: ReportScope = {
    administratorId: 'admin',
    estateIds: ['estate'],
    estates: [{ id: 'estate', name: 'Comunidad' }],
    mode: 'selected',
    user: {
      id: 'actor',
      role: 'B',
      administratorId: 'admin',
      estateIds: ['estate'],
    },
  };
  const input: ReportInput = {
    scopeMode: 'selected',
    estateIds: ['estate'],
    from: '2026-09-01',
    to: '2026-09-30',
  };
  const result: ReportResult = {
    metadata: {
      reportKey: 'monthly-executive',
      title: 'Informe',
      generatedAt: '2026-10-15T12:00:00Z',
      scope: { mode: 'selected', estates: scope.estates },
      period: { from: input.from, to: input.to },
      currency: 'EUR',
      sensitivity: 'financial',
      warnings: [],
    },
    summary: [{ label: 'Ingresos', value: 123.45, format: 'money' }],
    sections: [],
    rowCount: 0,
  };
  beforeEach(() => {
    saved = undefined;
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());
  async function create() {
    return service.create(
      structuredClone(result),
      structuredClone(input),
      scope,
      'actor',
    );
  }
  it('preserves the canonical content for thirty days despite later source mutations', async () => {
    const source = structuredClone(result);
    const ref = await service.create(source, input, scope, 'actor');
    expect(
      new Date(ref.metadata.snapshotExpiresAt).getTime() -
        new Date(ref.metadata.generatedAt).getTime(),
    ).toBe(30 * 86400000);
    source.summary[0].value = 999;
    ref.summary[0].value = 777;
    expect(
      (
        await service.load(
          ref.metadata.snapshotId,
          'monthly-executive',
          input,
          scope,
          'actor',
        )
      ).summary[0].value,
    ).toBe(123.45);
  });
  it.each(['actor', 'administrator', 'scope'])(
    'rejects changed authorization %s',
    async (changed) => {
      const ref = await create();
      await expect(
        service.load(
          ref.metadata.snapshotId,
          'monthly-executive',
          input,
          changed === 'administrator'
            ? { ...scope, administratorId: 'foreign' }
            : changed === 'scope'
              ? { ...scope, estateIds: ['other'] }
              : scope,
          changed === 'actor' ? 'other-actor' : 'actor',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('rejects a changed period rather than returning stale content', async () => {
    const ref = await create();
    await expect(
      service.load(
        ref.metadata.snapshotId,
        'monthly-executive',
        { ...input, to: '2026-10-31' },
        scope,
        'actor',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('ignores transport fields and object key order when matching canonical input', async () => {
    const ref = await create();
    const reordered = {
      to: input.to,
      from: input.from,
      estateIds: ['estate'],
      scopeMode: 'selected',
      format: 'pdf',
      snapshotId: ref.metadata.snapshotId,
    } as ReportInput;
    await expect(
      service.load(
        ref.metadata.snapshotId,
        'monthly-executive',
        reordered,
        scope,
        'actor',
      ),
    ).resolves.toEqual(ref);
  });
  it('returns 404 for missing, expired and mismatched report IDs', async () => {
    await expect(
      service.load('missing', 'monthly-executive', input, scope, 'actor'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const ref = await create();
    await expect(
      service.load(
        ref.metadata.snapshotId,
        'meeting-finance',
        input,
        scope,
        'actor',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    jest.setSystemTime(new Date(ref.metadata.snapshotExpiresAt));
    await expect(
      service.load(
        ref.metadata.snapshotId,
        'monthly-executive',
        input,
        scope,
        'actor',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('does not persist other report families', async () => {
    await expect(
      service.create(
        {
          ...result,
          metadata: { ...result.metadata, reportKey: 'communities' },
        },
        input,
        scope,
        'actor',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.reportSnapshot.create).not.toHaveBeenCalled();
  });
  it('purges only the active tenant expired rows during creation and globally on scheduled retention', async () => {
    await create();
    expect(prisma.reportSnapshot.deleteMany).toHaveBeenCalledWith({
      where: { administratorId: 'admin', expiresAt: { lte: new Date() } },
    });
    await service.purgeExpired();
    expect(prisma.reportSnapshot.deleteMany).toHaveBeenLastCalledWith({
      where: { expiresAt: { lte: new Date() } },
    });
  });
  it('normalizes the order of selected community IDs without accepting a changed membership', async () => {
    const selected = { ...scope, estateIds: ['a', 'b'] };
    const selectedInput = { ...input, estateIds: ['a', 'b'] };
    const stored = await service.create(
      result,
      selectedInput,
      selected,
      'actor',
    );
    await expect(
      service.load(
        stored.metadata.snapshotId,
        'monthly-executive',
        { ...selectedInput, estateIds: ['b', 'a'] },
        { ...selected, estateIds: ['b', 'a'] },
        'actor',
      ),
    ).resolves.toEqual(stored);
    await expect(
      service.load(
        stored.metadata.snapshotId,
        'monthly-executive',
        selectedInput,
        { ...selected, estateIds: ['a', 'c'] },
        'actor',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
