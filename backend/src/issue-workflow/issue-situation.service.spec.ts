import { IssueSituationService } from './issue-situation.service';
import type { IssueFacts } from './issue-situation';

describe('IssueSituationService classified projections', () => {
  it('builds page views from retained facts without loading them again', async () => {
    const now = new Date('2026-10-28T10:00:00.000Z');
    const facts: IssueFacts = {
      issueId: 'i1',
      status: 'Abierta',
      tasks: [],
      waits: [],
      visits: [],
      lastActivityAt: now,
      infoRequestedAt: null,
    };
    const service = new IssueSituationService({} as never, {} as never);
    const loadFacts = jest.spyOn(service, 'loadFacts');

    const views = await service.viewsFromClassified([
      {
        id: 'i1',
        situation: 'no_pending_action',
        ball: 'nobody',
        ref: 'INC-1',
        title: 'Fuga',
        estateName: 'Sol',
        status: 'Abierta',
        facts,
        estateId: 'e1',
        type: 'Averia',
        priority: 'Normal',
        evaluatedAt: now,
        options: {},
      },
    ]);

    expect(loadFacts).not.toHaveBeenCalled();
    expect(views.get('i1')).toMatchObject({
      issueId: 'i1',
      situation: 'no_pending_action',
      ballInCourt: { primary: 'nobody' },
    });
  });

  it('classifies large scopes in database-safe 5,000-item batches', async () => {
    const now = new Date('2026-10-28T10:00:00.000Z');
    const issues = Array.from({ length: 5_001 }, (_, index) => ({
      id: `i${index}`,
      ref: `INC-${index}`,
      title: 'Fuga',
      status: 'Abierta' as const,
      estateId: 'e1',
      type: 'Averia',
      priority: 'Normal' as const,
      estate: { name: 'Sol' },
    }));
    const service = new IssueSituationService(
      { issue: { findMany: jest.fn().mockResolvedValue(issues) } } as never,
      {} as never,
      {} as never,
    );
    const loadFacts = jest.spyOn(service, 'loadFacts').mockImplementation(
      async (ids) =>
        new Map(
          ids.map((id) => [
            id,
            {
              issueId: id,
              status: 'Abierta' as const,
              tasks: [],
              waits: [],
              visits: [],
              lastActivityAt: now,
              infoRequestedAt: null,
            },
          ]),
        ),
    );

    await service.classify({}, 'newest', now);

    expect(loadFacts).toHaveBeenCalledTimes(2);
    expect(loadFacts.mock.calls.map(([ids]) => ids.length)).toEqual([5_000, 1]);
  });
});
