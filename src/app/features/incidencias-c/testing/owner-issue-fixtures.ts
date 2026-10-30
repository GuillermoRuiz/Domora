import type { OwnerIssueDetail, OwnerIssueList, OwnerIssueListItem } from '../../../core/owner-issues.models';

/** Test data for the «Incidencias» specs (shapes of `/me/issues`). */
export function issueItem(overrides: Partial<OwnerIssueListItem> = {}): OwnerIssueListItem {
  return {
    id: 'i1',
    ref: 'INC-0001',
    title: 'Gotera en el garaje',
    description: 'Cae agua del techo junto a la plaza 12 cuando llueve.',
    type: 'Fuga',
    location: 'Garaje',
    status: 'Abierta',
    priority: 'Normal',
    date: '2026-10-20T00:00:00.000Z',
    estateId: 'e1',
    estateName: 'Edificio Sol',
    mine: true,
    awaitingMyAnswer: false,
    affectedCount: 0,
    affectedByMe: false,
    ...overrides,
  };
}

export function issueList(items: OwnerIssueListItem[] = [issueItem()], kpis = { open: 3, inProgress: 2, resolved: 5 }): OwnerIssueList {
  return { items, kpis };
}

export function issueDetail(overrides: Partial<OwnerIssueDetail> = {}): OwnerIssueDetail {
  return {
    ...issueItem(),
    createdAt: '2026-10-20T08:30:00.000Z',
    resolvedAt: null,
    attachments: [],
    timeline: [
      { id: 't1', date: '2026-10-20T08:30:00.000Z', kind: 'status_changed', role: 'Sistema', author: 'Sistema', text: 'Incidencia registrada.', fromStatus: null, toStatus: 'Abierta' },
    ],
    rating: null,
    ratingComment: null,
    expectedResponseHours: 72,
    canReply: true,
    canWithdraw: true,
    withdrawBlockedByOthers: false,
    canReopen: false,
    canRate: false,
    canMarkAffected: false,
    ...overrides,
  };
}
