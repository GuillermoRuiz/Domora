import { IssuesService } from './issues.service';

describe('issue lifecycle persistence', () => {
  let issue: any;
  let service: IssuesService;
  const user = { id: 'manager', role: 'B' as const, administratorId: 'admin', estateIds: ['estate'] };
  beforeEach(() => {
    issue = { id: 'issue', status: 'Abierta', property: { estateId: 'estate' }, timeline: [], resolvedAt: null, closedAt: null };
    const db: any = { $queryRaw: jest.fn(), insuranceClaim: { findFirst: async () => null }, issue: {
      findFirst: async () => issue, findUniqueOrThrow: async () => issue,
      update: async ({ data }: any) => {
        const { timeline, ...fields } = data;
        Object.assign(issue, fields);
        if (timeline) issue.timeline.push({ ...timeline.create, authorUser: null });
        return issue;
      },
    } };
    db.$transaction = async (fn: any) => fn(db);
    service = new IssuesService(db, { assertAccess() {} } as any, {} as any);
  });
  afterEach(() => jest.useRealTimers());
  it.each(['Abierta', 'PendienteProveedor'] as const)('persists structured resolution from %s', async status => {
    issue.status = status;
    await service.updateStatus('issue', { status: 'Resuelta' }, user);
    expect(issue.resolvedAt).toBeInstanceOf(Date);
    expect(issue.timeline[0]).toEqual(expect.objectContaining({ fromStatus: status, toStatus: 'Resuelta', authorUserId: user.id, date: issue.resolvedAt }));
  });
  it('persists direct closure without fabricating a resolution', async () => {
    await service.updateStatus('issue', { status: 'Cerrada' }, user);
    expect(issue.closedAt).toBeInstanceOf(Date);
    expect(issue.resolvedAt).toBeNull();
    expect(issue.timeline[0].fromStatus).toBe('Abierta');
  });
  it('preserves both resolution events after reopening, with actual event durations', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    await service.updateStatus('issue', { status: 'Resuelta' }, user);
    jest.setSystemTime(new Date('2026-10-02T00:00:00Z'));
    await service.updateStatus('issue', { status: 'Abierta' }, user);
    expect(issue.resolvedAt).toBeNull();
    jest.setSystemTime(new Date('2026-10-05T00:00:00Z'));
    await service.updateStatus('issue', { status: 'Resuelta' }, user);
    expect(issue.timeline).toHaveLength(3);
    expect(issue.timeline.map((e: any) => [e.fromStatus, e.toStatus])).toEqual([['Abierta', 'Resuelta'], ['Resuelta', 'Abierta'], ['Abierta', 'Resuelta']]);
    expect(issue.timeline[2].date.getTime() - issue.timeline[1].date.getTime()).toBe(3 * 86400000);
    expect(issue.resolvedAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });
});
