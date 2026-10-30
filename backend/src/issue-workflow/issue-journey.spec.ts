import {
  projectJourney,
  type JourneyFacts,
  type JourneyStep,
} from './issue-journey';

const at = (iso: string) => new Date(`2026-10-${iso}:00Z`);
const NOW = at('27T10:00');

const base = (over: Partial<JourneyFacts> = {}): JourneyFacts => ({
  now: NOW,
  route: 'community_insurance',
  issueStatus: 'Abierta',
  createdAt: at('20T09:00'),
  resolvedAt: null,
  terminal: false,
  awaitingRequesterInfo: false,
  tasks: [],
  waits: [],
  visits: [],
  claims: [],
  events: [],
  ...over,
});

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: 'review_issue',
  reason: null,
  label: 'Revisar',
  status: 'PENDIENTE' as const,
  priority: 'MEDIA' as const,
  assigneeName: null,
  dueAt: at('28T10:00'),
  createdAt: at('20T09:00'),
  completedAt: null,
  ...over,
});
const wait = (id: string, over: Record<string, unknown> = {}) => ({
  id: id + '-wait',
  kind: 'insurer_reply',
  party: 'insurer' as const,
  partyLabel: 'Mapfre',
  startedAt: at('22T10:00'),
  dueAt: at('30T10:00'),
  endedAt: null,
  endReason: null,
  claimId: null,
  ...over,
});
const claim = (over: Record<string, unknown> = {}) => ({
  id: 'claim-0001-aaaa',
  insurerName: 'Mapfre',
  reference: 'SIN-2026-005',
  status: 'open',
  openedAt: at('21T10:00'),
  closedAt: null,
  ...over,
});

const by = (steps: JourneyStep[], status: JourneyStep['status']) =>
  steps.filter((s) => s.status === status);
const labels = (steps: JourneyStep[]) => steps.map((s) => s.label);

describe('projectJourney: pasado, presente y futuro inmediato', () => {
  it('seguro de la comunidad, flujo normal: solo lo que ocurrió, una situación actual y un «después»', () => {
    const view = projectJourney(
      base({
        tasks: [
          task('t1', {
            status: 'COMPLETADA',
            reason: 'open_insurance_claim',
            completedAt: at('21T09:30'),
          }),
        ],
        claims: [claim({ status: 'accepted' })],
        events: [
          {
            id: 'ev-accepted-1',
            kind: 'claim_updated',
            date: at('22T09:00'),
            refId: 'claim-0001-aaaa',
            meta: { from: 'open', to: 'accepted' },
          },
        ],
        visits: [
          {
            id: 'v1-aaaa-bbbb',
            scheduledAt: at('30T12:00'),
            completedAt: null,
            status: 'planificada',
            purpose: 'Visita del perito',
            visitor: 'Peritos SL',
          },
        ],
      }),
      [],
    );
    expect(labels(by(view.steps, 'completed'))).toEqual([
      'Incidencia creada',
      'Contactar con el seguro de la comunidad',
      'Siniestro SIN-2026-005 abierto',
      'Seguro confirma cobertura',
    ]);
    const current = by(view.steps, 'current');
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({
      label: 'Visita del perito',
      source: { type: 'visit', id: 'v1-aaaa-bbbb' },
      action: { type: 'manage_visit', entityId: 'v1-aaaa-bbbb' },
      subtitle: 'Profesional: Peritos SL',
    });
    expect(labels(by(view.steps, 'upcoming'))).toEqual(expect.arrayContaining([
      'Después: revisar el resultado',
    ]));
    expect(view.status).toBe('on_track');
    // Nunca se pinta la rama futura como si estuviera confirmada.
    expect(labels(view.steps)).not.toContain('Incidencia resuelta');
  });

  it('el seguro rechaza: lo actual es revisar el rechazo (tarea); tras reclamar, esperar la nueva respuesta', () => {
    const rejected = projectJourney(
      base({
        claims: [claim({ status: 'rejected' })],
        events: [
          {
            id: 'ev-rej-0001',
            kind: 'claim_updated',
            date: at('23T10:00'),
            refId: 'claim-0001-aaaa',
            meta: { to: 'rejected' },
          },
        ],
        tasks: [
          task('t2', {
            label: 'Revisar el rechazo del seguro',
            reason: 'claim_rejected',
          }),
        ],
      }),
      [],
    );
    expect(labels(by(rejected.steps, 'completed'))).toContain(
      'Seguro rechaza cobertura',
    );
    expect(by(rejected.steps, 'current')[0]).toMatchObject({
      label: 'Revisar el rechazo del seguro',
      action: { type: 'open_task', entityId: 't2' },
      claim: { reference: 'SIN-2026-005', status: 'rejected' },
    });

    const reclaimed = projectJourney(
      base({
        claims: [claim({ status: 'rejected' })],
        tasks: [
          task('t2', {
            status: 'COMPLETADA',
            completedAt: at('24T10:00'),
            label: 'Revisar el rechazo del seguro',
          }),
        ],
        waits: [wait('w1')],
      }),
      [],
    );
    expect(by(reclaimed.steps, 'current')[0]).toMatchObject({
      label: 'Esperando respuesta de Mapfre',
      action: { type: 'register_response', entityId: 'w1-wait' },
    });
  });

  it('el seguro pide información: tarea de aportarla y después una nueva espera', () => {
    const asking = projectJourney(
      base({
        claims: [claim()],
        waits: [
          wait('w1', { endedAt: at('23T10:00'), endReason: 'fulfilled' }),
        ],
        tasks: [
          task('t3', { label: 'Aportar la información que pide el seguro' }),
        ],
      }),
      [],
    );
    expect(labels(by(asking.steps, 'completed'))).toContain(
      'Respuesta de Mapfre',
    );
    expect(by(asking.steps, 'current')[0].label).toBe(
      'Aportar la información que pide el seguro',
    );
    const waiting = projectJourney(
      base({
        claims: [claim()],
        waits: [
          wait('w1', { endedAt: at('23T10:00'), endReason: 'fulfilled' }),
          wait('w2', { startedAt: at('25T10:00'), dueAt: at('29T10:00') }),
        ],
        tasks: [
          task('t3', {
            status: 'COMPLETADA',
            completedAt: at('25T09:00'),
            label: 'Aportar la información',
          }),
        ],
      }),
      [],
    );
    expect(by(waiting.steps, 'current')[0].label).toBe(
      'Esperando respuesta de Mapfre',
    );
  });

  it('el seguro no responde: la espera vencida se marca vencida y pide registrar la respuesta', () => {
    const view = projectJourney(
      base({
        claims: [claim()],
        waits: [wait('w1', { dueAt: at('26T10:00') })],
      }),
      [],
    );
    const current = by(view.steps, 'current')[0];
    expect(current.overdue).toBe(true);
    expect(current.startedAt).toBe(at('22T10:00').toISOString());
    expect(current.action?.type).toBe('register_response');
  });

  it('proveedor: contacto → espera → visita → resultado → resuelta', () => {
    const view = projectJourney(
      base({
        route: 'community_provider',
        resolvedAt: at('26T12:00'),
        terminal: true,
        tasks: [
          task('t1', {
            status: 'COMPLETADA',
            reason: 'contact_provider',
            completedAt: at('20T10:00'),
          }),
        ],
        waits: [
          wait('w1', {
            kind: 'provider_reply',
            party: 'provider',
            partyLabel: 'Ascensores Levante',
            endedAt: at('21T10:00'),
            endReason: 'fulfilled',
          }),
        ],
        visits: [
          {
            id: 'v1-aaaa',
            scheduledAt: at('24T10:00'),
            completedAt: at('24T11:00'),
            status: 'realizada',
            purpose: 'Reparación',
            visitor: 'Ascensores Levante',
          },
        ],
      }),
      [],
    );
    expect(labels(view.steps)).toEqual([
      'Incidencia creada',
      'Proveedor contactado',
      'Respuesta de Ascensores Levante',
      'Visita de Ascensores Levante realizada',
      'Incidencia resuelta',
    ]);
    expect(by(view.steps, 'current')).toHaveLength(0);
    expect(view.status).toBe('resolved');
  });

  it('seguro del propietario: pedir al propietario → espera → respuesta', () => {
    const view = projectJourney(
      base({
        route: 'owner_insurance',
        tasks: [
          task('t1', {
            status: 'COMPLETADA',
            reason: 'ask_owner_file_claim',
            completedAt: at('20T12:00'),
          }),
        ],
        waits: [
          wait('w1', { kind: 'owner_reply', party: 'owner', partyLabel: null }),
        ],
      }),
      [],
    );
    expect(labels(by(view.steps, 'completed'))).toContain(
      'Propietario avisado para tramitar el siniestro',
    );
    expect(by(view.steps, 'current')[0].label).toBe(
      'Esperando respuesta del propietario',
    );
  });

  it('gestión directa: siempre una acción concreta; nunca «en marcha» como paso indefinido', () => {
    const view = projectJourney(
      base({
        route: 'direct_management',
        tasks: [
          task('t1', { label: 'Llamar al fontanero', assigneeName: 'Isabel' }),
        ],
      }),
      [],
    );
    expect(by(view.steps, 'current')[0]).toMatchObject({
      label: 'Llamar al fontanero',
      subtitle: 'Responsable: Isabel',
      action: { type: 'open_task' },
    });
    expect(labels(view.steps)).not.toContain('Gestión directa en marcha');
  });

  it('cambio de vía: conserva el pasado, deja un hito «Vía cambiada» y construye la nueva rama', () => {
    const view = projectJourney(
      base({
        route: 'community_provider',
        claims: [claim({ status: 'rejected' })],
        events: [
          {
            id: 'ev-rej-0001',
            kind: 'claim_updated',
            date: at('23T10:00'),
            refId: 'claim-0001-aaaa',
            meta: { to: 'rejected' },
          },
          {
            id: 'ev-route-01',
            kind: 'route_decided',
            date: at('24T10:00'),
            refId: null,
            meta: { from: 'community_insurance', to: 'community_provider' },
          },
        ],
        tasks: [
          task('t9', {
            label: 'Contactar con el proveedor',
            reason: 'contact_provider',
          }),
        ],
      }),
      [],
    );
    const done = labels(by(view.steps, 'completed'));
    expect(done).toContain('Seguro rechaza cobertura');
    expect(done).toContain(
      'Vía cambiada: Seguro de la comunidad → Proveedor (sin seguro)',
    );
    expect(by(view.steps, 'current')[0].label).toBe(
      'Contactar con el proveedor',
    );
    expect(labels(by(view.steps, 'upcoming'))).toEqual([
      'Después: esperar la respuesta del proveedor',
    ]);
  });

  it('la primera decisión de vía no es un cambio de vía', () => {
    const view = projectJourney(
      base({
        events: [
          {
            id: 'ev-route-01',
            kind: 'route_decided',
            date: at('20T10:00'),
            refId: null,
            meta: { from: null, to: 'community_insurance' },
          },
        ],
        tasks: [task('t1')],
      }),
      [],
    );
    expect(labels(view.steps).some((l) => l.startsWith('Vía cambiada'))).toBe(
      false,
    );
  });

  it('abierta y sin tarea, espera, visita ni trabajo de Domora: «Definir siguiente paso», no «sin acción pendiente»', () => {
    const view = projectJourney(base(), []);
    expect(view.status).toBe('needs_attention');
    expect(by(view.steps, 'current')[0]).toMatchObject({
      label: 'Definir siguiente paso',
      action: { type: 'register_activity' },
    });
    expect(
      projectJourney(base({ route: null }), []).steps.find(
        (s) => s.status === 'current',
      )?.action,
    ).toEqual({ type: 'change_route' });
  });

  it('una visita vencida sin resultado pide confirmar el resultado', () => {
    const view = projectJourney(
      base({
        visits: [
          {
            id: 'v1-aaaa',
            scheduledAt: at('26T10:00'),
            completedAt: null,
            status: 'planificada',
            purpose: 'Revisión',
            visitor: 'Pintores SL',
          },
        ],
      }),
      [],
    );
    const current = by(view.steps, 'current')[0];
    expect(current.overdue).toBe(true);
    expect(current.label).toMatch(/^Confirmar el resultado/);
  });
});

describe('projectJourney: hitos del sistema frente a hitos propios', () => {
  const custom = {
    id: 'c0000000-0000-4000-8000-000000000001',
    templateKey: null,
    label: 'Hablar con el presidente',
    position: 10,
    hidden: false,
    doneAt: null,
    linkedStatus: null,
  };

  it('seguro de la comunidad siempre expone los tres hitos base y permite insertar hitos antes del cierre', () => {
    const view = projectJourney(base({ tasks: [task('t1')] }), [custom]);
    const milestones = view.steps.filter((step) => step.milestone);

    expect(milestones.map((step) => [step.label, step.status])).toEqual([
      ['Incidencia creada', 'completed'],
      ['Contactar con el seguro de la comunidad', 'upcoming'],
      ['Hablar con el presidente', 'upcoming'],
      ['Incidencia cerrada', 'upcoming'],
    ]);
  });

  it('renombrar el cierre no adopta la posición por defecto del ajuste: sigue siendo el último hito', () => {
    const view = projectJourney(base({ tasks: [task('t1')] }), [
      custom,
      {
        id: 'o-resolved',
        templateKey: 'resolved',
        label: 'Cierre editado',
        position: 0,
        hidden: false,
        doneAt: null,
      },
    ]);
    const milestones = view.steps.filter((step) => step.milestone);

    expect(milestones.at(-1)).toMatchObject({ key: 'resolved', label: 'Cierre editado', position: 1_000_000 });
  });

  it('devuelve el estado asociado de los hitos fijos', () => {
    const view = projectJourney(base({ tasks: [task('t1')] }), [
      {
        id: 'o-contact',
        templateKey: 'community_insurance:contact',
        label: null,
        position: 0,
        hidden: false,
        doneAt: null,
        linkedStatus: 'PendienteProveedor',
      },
      {
        id: 'o-created',
        templateKey: 'created',
        label: null,
        position: 0,
        hidden: false,
        doneAt: null,
        linkedStatus: 'Abierta',
      },
    ]);

    expect(view.steps.find((step) => step.key === 'created')?.linkedStatus).toBe('Abierta');
    expect(view.steps.find((step) => step.key === 'community_insurance:contact')?.linkedStatus).toBe('PendienteProveedor');
  });

  it('un hito asociado queda completado desde la primera vez que la incidencia alcanzó ese estado', () => {
    const reachedAt = at('24T11:00');
    const view = projectJourney(base({
      issueStatus: 'Abierta',
      events: [{
        id: 'status-1', kind: 'status_changed', date: reachedAt, refId: null, meta: null,
        fromStatus: 'Abierta', toStatus: 'EnReparacion',
      }],
    }), [{ ...custom, linkedStatus: 'EnReparacion' }]);

    expect(view.steps.find((step) => step.custom)).toMatchObject({
      status: 'completed', completedAt: reachedAt.toISOString(), linkedStatus: 'EnReparacion',
    });
  });

  it('un hito propio pendiente se muestra como pendiente y, hecho, entra en el pasado en su fecha', () => {
    const open = projectJourney(base({ tasks: [task('t1')] }), [custom]);
    expect(by(open.steps, 'upcoming').map((s) => s.label)).toContain(
      'Hablar con el presidente',
    );
    expect(by(open.steps, 'upcoming').find((step) => step.custom)?.source?.type).toBe('custom');
    const done = projectJourney(base({ tasks: [task('t1')] }), [
      { ...custom, doneAt: at('22T09:00') },
    ]);
    expect(labels(by(done.steps, 'completed'))).toEqual([
      'Incidencia creada',
      'Hablar con el presidente',
    ]);
  });

  it('un ajuste «hecho a mano» sobre un hito del sistema se ignora: no se falsifican eventos', () => {
    const view = projectJourney(base({ tasks: [task('t1')] }), [
      {
        id: 'o1',
        templateKey: 'claim_opened',
        label: null,
        position: 0,
        hidden: false,
        doneAt: at('22T09:00'),
      },
      {
        id: 'o2',
        templateKey: 'resolved',
        label: null,
        position: 0,
        hidden: false,
        doneAt: at('22T09:00'),
      },
    ]);
    expect(labels(view.steps)).not.toContain('Incidencia resuelta');
    expect(view.steps.some((s) => s.key.startsWith('claim'))).toBe(false);
  });

  it('un hito del sistema ya ocurrido se puede renombrar u ocultar, salvo «creada» y «resuelta»', () => {
    const facts = base({ claims: [claim()], tasks: [task('t1')] });
    const key = projectJourney(facts, []).steps.find((s) =>
      s.key.startsWith('claim:'),
    )!.key;
    const renamed = projectJourney(facts, [
      {
        id: 'o1',
        templateKey: key,
        label: 'Alta del siniestro',
        position: 0,
        hidden: false,
        doneAt: null,
      },
    ]);
    expect(labels(renamed.steps)).toContain('Alta del siniestro');
    const hidden = projectJourney(facts, [
      {
        id: 'o1',
        templateKey: key,
        label: null,
        position: 0,
        hidden: true,
        doneAt: null,
      },
      {
        id: 'o2',
        templateKey: 'created',
        label: null,
        position: 0,
        hidden: true,
        doneAt: null,
      },
    ]);
    expect(hidden.steps.some((s) => s.key === key)).toBe(false);
    expect(labels(hidden.steps)).toContain('Incidencia creada');
  });
});
