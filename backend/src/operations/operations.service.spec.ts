import { BadRequestException, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { OperationsService } from './operations.service';
import { IssuesQueryDto } from './operations-query.dto';
import type { AuthenticatedUser } from '../auth/auth.types';

describe('OperationsService', () => {
  const user: AuthenticatedUser = {
    id: 'u1',
    role: 'B',
    estateIds: ['e1', 'e2'],
    administratorId: 'a1',
  };
  function setup() {
    const model = () => ({
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    });
    const prisma = {
      meeting: model(),
      issue: model(),
      asset: {
        findFirst: jest.fn().mockResolvedValue({ id: 'a1', name: 'Cubierta' }),
      },
    };
    const situation = {
      classify: jest.fn().mockResolvedValue([]),
      viewsFromClassified: jest.fn().mockResolvedValue(new Map()),
      viewsFor: jest.fn().mockResolvedValue(new Map()),
    };
    const service = new OperationsService(prisma as never, situation as never);
    return { service, prisma, situation };
  }
  it('scopes meetings and all statistics to the current administrator and JWT estates', async () => {
    const { service, prisma } = setup();
    await service.meetings(user, {});
    const where = prisma.meeting.findMany.mock.calls[0][0].where;
    expect(where.estateId).toEqual({ in: ['e1', 'e2'] });
    expect(where.estate).toEqual({ administratorId: 'a1', deletedAt: null });
    for (const [query] of prisma.meeting.count.mock.calls)
      expect(query.where).toMatchObject(where);
  });
  it('rejects a community outside the JWT scope before querying', async () => {
    const { service, prisma } = setup();
    await expect(
      service.issues(user, { estateId: 'other' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });
  it('denies non-managers and managers without an administrator', async () => {
    const { service } = setup();
    for (const denied of [
      { ...user, role: 'C' as const },
      { ...user, role: 'A' as const },
      { ...user, administratorId: null },
    ]) {
      await expect(service.meetings(denied, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });
  it('keeps an empty estate scope empty when projecting the situation', async () => {
    const { service, situation } = setup();
    await service.issues({ ...user, estateIds: [] }, { page: 2, pageSize: 10 });
    expect(situation.classify).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: null,
        estateId: { in: [] },
        estate: expect.objectContaining({ deletedAt: null }),
      }),
      'newest',
    );
  });

  describe('issues list', () => {
    const issue = (id: string) => ({
      id,
      title: `Incidencia ${id}`,
      status: 'Abierta',
      date: new Date('2026-10-28T10:00:00.000Z'),
      description: 'Primera línea\nDetalle que no necesita el listado',
      ref: `INC-${id}`,
      estate: {
        id: 'e1',
        name: 'Sol',
      },
    });
    const classified = [
      { id: 'i1', situation: 'requires_attention', ball: 'administration' },
      { id: 'i2', situation: 'waiting_third_party', ball: 'insurer' },
      { id: 'i3', situation: 'stalled', ball: 'nobody' },
      { id: 'i4', situation: 'completed', ball: 'nobody' },
    ];
    function withIssues() {
      const h = setup();
      h.situation.classify.mockResolvedValue(classified);
      // 1.ª llamada: los que cumplen búsqueda, estado y fecha; 2.ª: las filas de la página.
      h.prisma.issue.findMany.mockImplementation(
        ({
          where,
          select,
        }: {
          where: { id?: { in: string[] } };
          select?: unknown;
        }) =>
          Promise.resolve(
            select && Object.keys(select).length === 1
              ? classified.map(({ id }) => ({ id }))
              : (where.id?.in ?? []).map(issue).reverse(),
          ),
      );
      return h;
    }

    it('counts the cards over the whole scope, whatever the other filters say', async () => {
      const { service } = withIssues();
      const result = await service.issues(user, { ball: 'insurer' });
      expect(result.summary).toEqual({
        all: 4,
        attention: 2,
        waiting: 1,
        resolved: 1,
      });
      expect(result.items.map((i) => i.id)).toEqual(['i2']);
      expect(result.total).toBe(1);
    });

    it('filters by card group and by exact situation, both at once', async () => {
      const { service } = withIssues();
      const group = await service.issues(user, { filter: 'attention' });
      expect(group.items.map((i) => i.id)).toEqual(['i1', 'i3']);
      const both = await service.issues(user, {
        filter: 'attention',
        situation: 'stalled',
      });
      expect(both.items.map((i) => i.id)).toEqual(['i3']);
    });

    it('keeps the projected order and paginates over the filtered result', async () => {
      const { service } = withIssues();
      const second = await service.issues(user, { page: 2, pageSize: 3 });
      expect(second.total).toBe(4);
      expect(second.items.map((i) => i.id)).toEqual(['i4']);
    });

    it('limits to the issues matching search, status and date', async () => {
      const { service, prisma } = withIssues();
      await service.issues(user, {
        search: 'agua',
        status: 'Abierta',
        created: '30d',
      });
      const where = prisma.issue.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        status: 'Abierta',
        date: { gte: expect.any(Date) },
      });
      expect(where.OR).toEqual(
        expect.arrayContaining([
          { title: { contains: 'agua', mode: 'insensitive' } },
          { ref: { contains: 'agua', mode: 'insensitive' } },
        ]),
      );
    });

    it('sorts by the column asked, keeping the date order for ties', async () => {
      const { service, situation, prisma } = withIssues();
      situation.classify.mockResolvedValue([
        {
          id: 'i1',
          situation: 'completed',
          ball: 'nobody',
          ref: '#2',
          title: 'b',
          estateName: 'Sol',
          status: 'Cerrada',
        },
        {
          id: 'i2',
          situation: 'requires_attention',
          ball: 'insurer',
          ref: '#10',
          title: 'a',
          estateName: 'Mar',
          status: 'Abierta',
        },
        {
          id: 'i3',
          situation: 'requires_attention',
          ball: 'administration',
          ref: '#1',
          title: 'c',
          estateName: 'Sol',
          status: 'EnReparacion',
        },
      ]);
      prisma.issue.findMany.mockImplementation(
        ({
          where,
          select,
        }: {
          where: { id?: { in: string[] } };
          select?: unknown;
        }) =>
          Promise.resolve(
            select && Object.keys(select).length === 1
              ? ['i1', 'i2', 'i3'].map((id) => ({ id }))
              : (where.id?.in ?? []).map(issue),
          ),
      );
      const ids = async (sort: never) =>
        (await service.issues(user, { sort })).items.map((i) => i.id);
      expect(await ids('ref_asc' as never)).toEqual(['i3', 'i1', 'i2']);
      expect(await ids('title_desc' as never)).toEqual(['i3', 'i1', 'i2']);
      expect(await ids('estate_asc' as never)).toEqual(['i2', 'i1', 'i3']);
      expect(await ids('status_asc' as never)).toEqual(['i2', 'i3', 'i1']);
      // Más urgente primero; entre iguales, el orden por fecha de la proyección.
      expect(await ids('situation_asc' as never)).toEqual(['i2', 'i3', 'i1']);
      expect(await ids('ball_asc' as never)).toEqual(['i3', 'i2', 'i1']);
      expect(await ids('ball_desc' as never)).toEqual(['i1', 'i2', 'i3']);
    });

    it('limits the scope to one installation and says which', async () => {
      const { service, prisma, situation } = withIssues();
      const result = await service.issues(user, { assetId: 'a1' });
      expect(situation.classify.mock.calls[0][0]).toMatchObject({
        assetId: 'a1',
      });
      expect(prisma.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1', estateId: { in: ['e1', 'e2'] } },
        }),
      );
      expect(result.asset).toEqual({ id: 'a1', name: 'Cubierta' });
    });

    it('attaches the projected situation to each row', async () => {
      const { service, situation } = withIssues();
      const view = { issueId: 'i1', situation: 'requires_attention' };
      situation.viewsFromClassified.mockResolvedValue(
        new Map([['i1', view]]),
      );
      const result = await service.issues(user, {
        filter: 'attention',
        pageSize: 1,
      });
      expect(result.items[0]).toMatchObject({ id: 'i1', situationView: view });
      expect(situation.viewsFromClassified).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'i1' })],
        { administratorId: 'a1' },
      );
      expect(situation.viewsFor).not.toHaveBeenCalled();
    });

    it('returns only the explicit issue list contract', async () => {
      const { service, prisma } = withIssues();
      const result = await service.issues(user, { pageSize: 1 });
      const pageQuery = prisma.issue.findMany.mock.calls[1][0];

      expect(pageQuery.include).toBeUndefined();
      expect(pageQuery.select).toEqual({
        id: true,
        title: true,
        status: true,
        date: true,
        description: true,
        ref: true,
        estate: {
          select: {
            id: true,
            name: true,
          },
        },
      });
      expect(Object.keys(result.items[0]).sort()).toEqual(
        [
          'date',
          'description',
          'estate',
          'id',
          'ref',
          'situationView',
          'status',
          'title',
        ].sort(),
      );
    });
  });

  it('filters the signed meetings and counts them apart from the celebrated ones', async () => {
    const { service, prisma } = setup();
    await service.meetings(user, { filter: 'firmada' });
    expect(prisma.meeting.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'firmada',
    });
    const counted = prisma.meeting.count.mock.calls.map(
      ([query]) => query.where.status,
    );
    expect(counted).toEqual(expect.arrayContaining(['celebrada', 'firmada']));
  });

  it('accepts the two states that only the issue flow sets as a status filter', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    for (const status of ['PendienteInformacion', 'Retirada'])
      expect(
        ((await pipe.transform({ status }, { type: 'query', metatype: IssuesQueryDto })) as IssuesQueryDto).status,
      ).toBe(status);
  });
  it('has no category query parameter: an issue is always an incidencia', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    await expect(
      pipe.transform({ category: 'Incidencia' }, { type: 'query', metatype: IssuesQueryDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('applies status to rows while retaining scope-wide statistics', async () => {
    const { service, prisma } = setup();
    await service.meetings(user, {
      filter: 'celebrada',
      search: 'Ascensor',
      estateId: 'e1',
    });
    const rows = prisma.meeting.findMany.mock.calls[0][0];
    expect(rows.where).toMatchObject({ estateId: 'e1', status: 'celebrada' });
    expect(rows.where.OR).toEqual(
      expect.arrayContaining([
        { title: { contains: 'Ascensor', mode: 'insensitive' } },
      ]),
    );
    expect(
      prisma.meeting.count.mock.calls.some(
        ([query]) => query.where.status === 'convocada',
      ),
    ).toBe(true);
  });
});
