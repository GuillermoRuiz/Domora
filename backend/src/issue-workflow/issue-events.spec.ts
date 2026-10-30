/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { issueEventData, IssueEventsService } from './issue-events.service';
import {
  ISSUE_EVENT_KINDS,
  REQUESTER_VISIBLE_EVENT_KINDS,
  actorLabel,
  defaultRoleFor,
  isVisibleToRequester,
} from './issue-event-kinds';
import { madridLocalToUtc } from './madrid-time';

describe('issueEventData: cada evento dice QUÉ actuó', () => {
  it('una persona exige su autor: sin él, la auditoría no serviría', () => {
    expect(() =>
      issueEventData({ kind: 'note', actorKind: 'person', text: 'hola' }),
    ).toThrow('ISSUE_EVENT_PERSON_WITHOUT_AUTHOR');
    const data = issueEventData({
      kind: 'note',
      actorKind: 'person',
      authorUserId: 'u1',
      text: 'hola',
    });
    expect(data).toMatchObject({
      actorKind: 'person',
      authorUserId: 'u1',
      role: 'Administrador',
      kind: 'note',
      internal: false,
    });
  });

  it('la IA, el sistema y un tercero no llevan autor y aparecen como «Sistema» en el papel del historial', () => {
    for (const actorKind of ['ai', 'system', 'external'] as const) {
      const data = issueEventData({ kind: 'task_opened', actorKind, text: 'x' });
      expect(data).toMatchObject({
        actorKind,
        authorUserId: null,
        role: 'Sistema',
      });
    }
  });

  it('LISTA BLANCA: un evento es interno salvo que su tipo esté expresamente permitido para el propietario', () => {
    for (const kind of ISSUE_EVENT_KINDS) {
      const visible = REQUESTER_VISIBLE_EVENT_KINDS.has(kind);
      expect(
        issueEventData({
          kind,
          actorKind: 'person',
          authorUserId: 'u',
          text: 'x',
        }).internal,
      ).toBe(!visible);
    }
    // Lo que NO debe verse por defecto: resúmenes del modelo, proveedor propuesto, decisiones de política, maquinaria.
    for (const kind of [
      'route_decided',
      'communication',
      'provider_chased',
      'task_opened',
      'wait_started',
    ] as const) {
      expect(isVisibleToRequester(kind, 'ai')).toBe(false);
      expect(
        issueEventData({ kind, actorKind: 'ai', text: 'x' }).internal,
      ).toBe(true);
    }
  });

  it('el propietario ve EXACTAMENTE lo aprobado (incluida la visita programada) y nada más', () => {
    expect([...REQUESTER_VISIBLE_EVENT_KINDS].sort()).toEqual(
      [
        'asset_linked',
        'budget_updated',
        'info_provided',
        'info_requested',
        'note',
        'notification_sent',
        'report_received',
        'requester_informed',
        'status_changed',
        'visit_scheduled',
      ].sort(),
    );
    // Decisiones internas, clasificación IA, proveedor sugerido antes de confirmarlo, política y tareas: nunca.
    for (const kind of [
      'provider_assigned',
      'route_decided',
      'task_opened',
      'task_resolved',
      'wait_overdue',
    ] as const)
      expect(isVisibleToRequester(kind, 'person')).toBe(false);
  });

  it('un tipo nuevo que alguien olvide declarar nace interno (el valor por defecto es esconder)', () => {
    const data = issueEventData({
      kind: 'tipo_nuevo' as never,
      actorKind: 'system',
      text: 'x',
    });
    expect(data.internal).toBe(true);
  });

  it('una nota del sistema o de la IA es interna; la de una persona se ve', () => {
    expect(
      issueEventData({ kind: 'note', actorKind: 'system', text: 'x' }).internal,
    ).toBe(true);
    expect(
      issueEventData({ kind: 'note', actorKind: 'ai', text: 'x' }).internal,
    ).toBe(true);
    expect(
      issueEventData({
        kind: 'note',
        actorKind: 'person',
        authorUserId: 'u',
        text: 'x',
      }).internal,
    ).toBe(false);
  });

  it('el llamante solo puede RESTRINGIR: marcar internal=false no hace visible lo que no está permitido', () => {
    expect(
      issueEventData({
        kind: 'task_opened',
        actorKind: 'ai',
        text: 'x',
        internal: false,
      }).internal,
    ).toBe(true);
    expect(
      issueEventData({
        kind: 'status_changed',
        actorKind: 'person',
        authorUserId: 'u',
        text: 'x',
        internal: true,
      }).internal,
    ).toBe(true);
  });

  it('guarda el puntero al artefacto y el detalle técnico, nunca copias del contenido', () => {
    const data = issueEventData({
      kind: 'communication',
      actorKind: 'system',
      text: 'Consulta enviada',
      refType: 'agenda_task',
      refId: 'm1',
      meta: { model: 'x' },
    });
    expect(data).toMatchObject({
      refType: 'agenda_task',
      refId: 'm1',
      meta: { model: 'x' },
    });
  });

  it('el rol del historial y el nombre a mostrar salen de quién actuó', () => {
    expect(defaultRoleFor('person')).toBe('Administrador');
    expect(defaultRoleFor('ai')).toBe('Sistema');
    expect(actorLabel('ai')).toBe('Domora');
    expect(actorLabel('system')).toBe('Sistema');
    expect(actorLabel('external')).toBe('Tercero');
    expect(actorLabel('person')).toBe('Usuario eliminado');
  });

  it('IssueEventsService.record escribe una fila del historial de esa incidencia', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'e1' });
    await new IssueEventsService().record(
      { issueTimelineEntry: { create } } as never,
      {
        issueId: 'i1',
        kind: 'task_opened',
        actorKind: 'ai',
        text: 'Se abrió una tarea',
        refType: 'agenda_task',
        refId: 't1',
      },
    );
    expect(create.mock.calls[0][0].data).toMatchObject({
      issueId: 'i1',
      kind: 'task_opened',
      actorKind: 'ai',
      internal: true,
      refId: 't1',
    });
  });
});

describe('madridLocalToUtc: las respuestas de los proveedores hablan en hora de Madrid', () => {
  it('en horario de verano (CEST, UTC+2)', () => {
    expect(madridLocalToUtc('2026-10-06', '09:00').toISOString()).toBe(
      '2026-10-06T07:00:00.000Z',
    );
    expect(madridLocalToUtc('2026-07-15', '23:30').toISOString()).toBe(
      '2026-07-15T21:30:00.000Z',
    );
  });
  it('en horario de invierno (CET, UTC+1)', () => {
    expect(madridLocalToUtc('2026-12-01', '09:00').toISOString()).toBe(
      '2026-12-01T08:00:00.000Z',
    );
  });
  it('el día del cambio de hora de otoño (25-oct-2026): antes y después de las 03:00', () => {
    expect(madridLocalToUtc('2026-10-25', '01:30').toISOString()).toBe(
      '2026-10-24T23:30:00.000Z',
    ); // aún CEST
    expect(madridLocalToUtc('2026-10-25', '09:00').toISOString()).toBe(
      '2026-10-25T08:00:00.000Z',
    ); // ya CET
  });
  it('el día del cambio de hora de primavera (29-mar-2026)', () => {
    expect(madridLocalToUtc('2026-03-29', '01:30').toISOString()).toBe(
      '2026-03-29T00:30:00.000Z',
    ); // CET
    expect(madridLocalToUtc('2026-03-29', '10:00').toISOString()).toBe(
      '2026-03-29T08:00:00.000Z',
    ); // CEST
  });
});
