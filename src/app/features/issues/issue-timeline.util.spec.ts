import { IssueTimelineEntry } from '../../core/models';
import { presentTimeline, whenLabel } from './issue-timeline.util';

const entry = (over: Partial<IssueTimelineEntry>): IssueTimelineEntry => ({
  date: '2026-10-22T09:00:00.000Z',
  author: 'Ana Gestora',
  role: 'Administrador',
  text: 'texto',
  kind: 'note',
  actorKind: 'person',
  ...over,
});

describe('presentTimeline: una sola cronología, sin maquinaria', () => {
  it('distingue persona, Domora, tercero, cambio de estado y comunicación', () => {
    const items = presentTimeline([
      entry({ kind: 'note', actorKind: 'person' }),
      entry({ kind: 'classified', actorKind: 'ai', author: 'Domora', role: 'Sistema' }),
      entry({ kind: 'provider_responded', actorKind: 'external', author: 'Tercero', role: 'Sistema' }),
      entry({ kind: 'status_changed', actorKind: 'person' }),
      entry({ kind: 'email_sent', actorKind: 'ai', author: 'Domora', role: 'Sistema' }),
    ]);
    expect(items.map((i) => i.tone)).toEqual(['person', 'domora', 'third', 'status', 'communication']);
  });

  it('oculta solo el envío en curso y cuenta tareas e hitos', () => {
    const items = presentTimeline([
      entry({ kind: 'task_opened', actorKind: 'ai', text: 'a' }),
      entry({ kind: 'task_resolved', actorKind: 'person', text: 'b' }),
      entry({ kind: 'milestone_done', actorKind: 'person', text: 'c' }),
      entry({ kind: 'email_sending', actorKind: 'system' }),
    ]);
    expect(items.map((i) => i.text)).toEqual(['a', 'b', 'c']);
    expect(items.map((i) => i.lead)).toEqual(['Tarea creada', 'Tarea completada', 'Hito completado']);
  });

  it('una gestión externa enseña canal y contraparte, nunca el detalle técnico', () => {
    const [item] = presentTimeline([
      entry({
        kind: 'communication',
        text: 'He llamado a Mapfre.',
        meta: { channel: 'phone', direction: 'outbound', party: 'insurer', partyLabel: 'Mapfre', supplierId: 'uuid-1', claimRef: 'SIN-9', effects: ['start_wait'] },
      }),
    ]);
    expect(item.detail).toBe('Llamada · Mapfre · Ref. SIN-9');
    expect(JSON.stringify(item)).not.toContain('uuid-1');
    expect(JSON.stringify(item)).not.toContain('start_wait');
  });

  it('el aviso al solicitante muestra el texto exacto enviado y no se duplica con el resumen de la gestión', () => {
    const items = presentTimeline([
      entry({ kind: 'requester_informed', actorKind: 'person', text: 'Se ha programado una visita para revisar tu incidencia: jueves.', meta: { template: 'visit_scheduled', recipientUserId: 'u' } }),
      entry({ kind: 'communication', text: 'Aviso al solicitante: hay una visita programada.', meta: { channel: 'other', party: 'requester', effects: ['inform_requester'] } }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ lead: 'Aviso al solicitante', text: 'Se ha programado una visita para revisar tu incidencia: jueves.', tone: 'communication' });
    expect(JSON.stringify(items[0])).not.toContain('recipientUserId');
  });

  it('la sugerencia de vía se marca como sugerencia, no como decisión', () => {
    const [suggested, decided] = presentTimeline([
      entry({ kind: 'route_suggested', actorKind: 'ai', text: 'Domora sugiere la vía: Seguro de la comunidad.', meta: { route: 'community_insurance', decision: { autonomy: 2 } } }),
      entry({ kind: 'route_decided', actorKind: 'person', text: 'Vía de gestión: Seguro de la comunidad.' }),
    ]);
    expect(suggested.lead).toBe('Sugerencia');
    expect(decided.lead).toBe('Vía de gestión');
    expect(JSON.stringify(suggested)).not.toContain('autonomy');
  });

  it('un proceso automático sin IA no lleva el icono de IA', () => {
    const [ai, system] = presentTimeline([entry({ kind: 'note', actorKind: 'ai' }), entry({ kind: 'wait_overdue', actorKind: 'system', author: 'Sistema' })]);
    expect(ai.icon).toBe('sparkles');
    expect(system.icon).toBe('settings');
  });

  it('el siniestro, su referencia y el profesional enviado por la aseguradora salen en la misma cronología, con su texto', () => {
    const items = presentTimeline([
      entry({ kind: 'claim_opened', text: 'Siniestro abierto con Mapfre.' }),
      entry({ kind: 'claim_updated', text: 'Mapfre asigna la referencia SIN-2026-0457 al siniestro.' }),
      entry({ kind: 'provider_assigned', text: 'Profesional asignado: Reparaciones Pérez, enviado por Mapfre.' }),
    ]);
    expect(items.map((i) => i.lead)).toEqual(['Siniestro', 'Siniestro', 'Profesional asignado']);
    expect(items.map((i) => i.text)).toEqual([
      'Siniestro abierto con Mapfre.',
      'Mapfre asigna la referencia SIN-2026-0457 al siniestro.',
      'Profesional asignado: Reparaciones Pérez, enviado por Mapfre.',
    ]);
  });

  it('las entradas antiguas sin tipo se tratan como notas de una persona', () => {
    const [old] = presentTimeline([{ date: '2026-01-01', author: 'Luis', role: 'Administrador', text: 'hola' }]);
    expect(old).toMatchObject({ tone: 'person', author: 'Luis', text: 'hola', lead: null, detail: null });
  });
});

describe('whenLabel: cuándo ocurrió', () => {
  it('con el instante exacto, día y hora de Madrid; sin él (eventos antiguos), solo el día', () => {
    expect(whenLabel(entry({ at: '2026-10-23T10:15:00.000Z', date: '2026-10-23' }))).toBe('23 oct, 12:15');
    expect(whenLabel(entry({ at: undefined, date: '2026-10-23' }))).toBe('23 oct 2026');
  });
});
