import {
  BALL_PARTIES,
  ISSUE_SITUATIONS,
  computeBallInCourt,
  computeSituation,
  type IssueFacts,
} from './issue-situation';

const NOW = new Date('2026-10-28T12:00:00Z');

const facts = (over: Partial<IssueFacts> = {}): IssueFacts => ({
  issueId: '00000000-0000-4000-8000-000000000001',
  status: 'Abierta',
  tasks: [],
  waits: [],
  visits: [],
  lastActivityAt: NOW,
  ...over,
});

describe('situación manual de incidencias', () => {
  it('no expone estados ni responsables de automatización', () => {
    expect(ISSUE_SITUATIONS).toEqual([
      'requires_attention',
      'waiting_third_party',
      'no_pending_action',
      'stalled',
      'completed',
    ]);
    expect(BALL_PARTIES).toEqual([
      'administration',
      'provider',
      'insurer',
      'owner',
      'other',
      'nobody',
    ]);
  });

  it('prioriza una tarea humana', () => {
    const value = facts({
      tasks: [{
        id: 'task-1',
        title: 'Decidir siguiente paso',
        kind: 'review_issue',
        priority: 'MEDIA',
        status: 'PENDIENTE',
        endAt: new Date('2026-10-29T12:00:00Z'),
        createdAt: NOW,
      }],
    });
    expect(computeSituation(value, NOW)).toBe('requires_attention');
    expect(computeBallInCourt(value, NOW).primary).toBe('administration');
  });

  it('representa una espera de tercero y los estados terminales', () => {
    const waiting = facts({
      waits: [{
        id: 'wait-1',
        kind: 'provider_reply',
        party: 'provider',
        partyLabel: 'Ascensores Norte',
        startedAt: NOW,
        dueAt: null,
      }],
    });
    expect(computeSituation(waiting, NOW)).toBe('waiting_third_party');
    expect(computeBallInCourt(waiting, NOW).primary).toBe('provider');
    expect(computeSituation(facts({ status: 'Cerrada' }), NOW)).toBe('completed');
  });

  it('marca como estancada una incidencia sin siguiente paso tras el margen', () => {
    const value = facts({ lastActivityAt: new Date('2026-10-28T06:00:00Z') });
    expect(computeSituation(value, NOW, { stalledGraceMs: 4 * 60 * 60_000 })).toBe('stalled');
  });
});
