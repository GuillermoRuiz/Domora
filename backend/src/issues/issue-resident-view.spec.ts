import { presentIssueForResident } from './issue-resident-view';

/** La proyección de un vecino sobre una común es una lista blanca: lo que no se elige a propósito, no sale. Sin base de datos. */
const at = new Date('2026-10-01T10:00:00Z');
const entry = (over: Record<string, unknown>) => ({
  id: 't',
  issueId: 'i1',
  date: at,
  authorUserId: 'mgr',
  role: 'Administrador',
  text: 'texto',
  fromStatus: null,
  toStatus: null,
  onBehalfOfUserId: 'secreto',
  kind: 'note',
  actorKind: 'person',
  refType: 'ai_message',
  refId: 'ref',
  meta: { secreto: true },
  internal: false,
  authorUser: { fullName: 'Nombre Real' },
  ...over,
});
const issue = (over: Record<string, unknown> = {}) =>
  ({
    id: 'i1',
    ref: '#INC-1',
    estateId: 'e1',
    location: null,
    rating: null,
    ratingComment: null,
    type: 'Averia',
    title: 'Ascensor',
    description: 'No funciona',
    status: 'Abierta',
    priority: 'Normal',
    source: 'Comunidad',
    date: at,
    createdAt: at,
    resolvedAt: null,
    closedAt: null,
    // Columnas de gestión Y una columna futura: ninguna debe llegar.
    assetId: 'asset',
    budgetAmount: '1.00',
    resolutionRoute: 'community_insurance',
    columnaNuevaDeLaGestion: 'secreto',
    photos: [
      {
        id: 'p1',
        issueId: 'i1',
        s3Key: 'issues/i1/x.jpg',
        url: null,
        uploadedAt: at,
      },
    ],
    timeline: [
      entry({
        id: 't1',
        kind: 'report_received',
        role: 'Propietario',
        authorUserId: 'me',
      }),
      entry({
        id: 't2',
        kind: 'note',
        role: 'Propietario',
        authorUserId: 'otro',
      }),
      entry({ id: 't3', kind: 'note' }),
      entry({ id: 't4', kind: 'note', internal: true }),
      entry({ id: 't5', kind: 'provider_assigned' }),
      entry({ id: 't6', kind: 'claim_opened' }),
      entry({ id: 't7', kind: 'note', actorKind: 'ai', role: 'Sistema' }),
      entry({
        id: 't8',
        kind: 'status_changed',
        fromStatus: 'Abierta',
        toStatus: 'Resuelta',
      }),
    ],
    ...over,
  }) as never;

describe('presentIssueForResident', () => {
  it('devuelve solo los campos permitidos', () => {
    const view = presentIssueForResident(issue(), 'me', false);
    expect(Object.keys(view).sort()).toEqual(
      [
        'closedAt',
        'createdAt',
        'date',
        'description',
        'estateId',
        'id',
        'location',
        'photos',
        'priority',
        'rating',
        'ratingComment',
        'ref',
        'reportedByMe',
        'resolvedAt',
        'source',
        'status',
        'timeline',
        'title',
        'type',
      ].sort(),
    );
    expect(JSON.stringify(view)).not.toMatch(
      /secreto|asset|community_insurance|x\.jpg|Nombre Real|refId|refType/,
    );
  });

  it('el historial: solo tipos permitidos y de personas, sin nombres ni referencias', () => {
    const view = presentIssueForResident(issue(), 'me', true);
    expect(view.timeline.map((e) => e.id)).toEqual(['t1', 't2', 't3', 't8']);
    expect(view.timeline.map((e) => e.author)).toEqual([
      'Tú',
      'Un vecino',
      'Administración',
      'Administración',
    ]);
    for (const e of view.timeline)
      expect(Object.keys(e).sort()).toEqual([
        'author',
        'date',
        'fromStatus',
        'id',
        'kind',
        'role',
        'text',
        'toStatus',
      ]);
    expect(view.reportedByMe).toBe(true);
  });

  it('el aviso que Domora le mandó a QUIEN la reportó lo ve solo él, y sin su meta', () => {
    const notice = entry({
      id: 'n1',
      kind: 'requester_informed',
      role: 'Sistema',
      actorKind: 'system',
      text: 'Tu incidencia se ha resuelto.',
      meta: { recipientUserIds: ['me', 'otro-reportante'], secreto: true },
    });
    const withNotice = issue({ timeline: [notice] });
    const mine = presentIssueForResident(withNotice, 'me', true).timeline;
    expect(mine.map((e) => e.id)).toEqual(['n1']);
    expect(mine[0]).not.toHaveProperty('meta');
    expect(
      presentIssueForResident(withNotice, 'un-vecino', false).timeline,
    ).toEqual([]);
  });

  it('las fotos salen sin su clave de almacenamiento', () => {
    expect(presentIssueForResident(issue(), 'me', false).photos).toEqual([
      { id: 'p1', issueId: 'i1', uploadedAt: at },
    ]);
  });
});
