import {
  BALL_LABEL,
  ISSUE_LIST_FILTERS,
  ISSUE_SITUATIONS,
  IssueSituationKey,
  NextStep,
  SITUATION_LABEL,
  ageLabel,
  describeNextStep,
  holderText,
  routeLabel,
} from './issue-workflow.models';

describe('textos de la situación', () => {
  it('cada proyección del backend tiene su etiqueta, sin nombres técnicos', () => {
    expect(SITUATION_LABEL).toEqual({
      requires_attention: 'Requiere atención',
      waiting_third_party: 'Esperando tercero',
      stalled: 'Sin siguiente paso',
      completed: 'Resuelta',
      no_pending_action: 'Sin acción pendiente',
    });
    expect(Object.keys(SITUATION_LABEL).sort()).toEqual([...ISSUE_SITUATIONS].sort());
  });

  it('quién tiene la pelota, en lenguaje de administrador', () => {
    expect(BALL_LABEL).toEqual({
      administration: 'Administración',
      provider: 'Proveedor',
      insurer: 'Seguro',
      owner: 'Propietario',
      other: 'Tercero',
      nobody: 'Sin siguiente responsable',
    });
  });

  it('la vía de gestión se entiende y «sin decidir» es «Por determinar»', () => {
    expect(routeLabel('community_provider')).toBe('Proveedor (sin seguro)');
    expect(routeLabel('community_insurance')).toBe('Seguro de la comunidad');
    expect(routeLabel('owner_insurance')).toBe('Seguro del propietario');
    expect(routeLabel('direct_management')).toBe('Administrador');
    expect(routeLabel(null)).toBe('Por determinar');
    expect(routeLabel(undefined)).toBe('Por determinar');
    expect(routeLabel('algo_raro')).toBe('Por determinar');
  });
});

describe('filtros orientados al trabajo', () => {
  it('son cinco y no uno por estado técnico', () => {
    expect(ISSUE_LIST_FILTERS.map((f) => f.label)).toEqual(['Todas', 'Requieren atención', 'Esperando tercero', 'Resueltas']);
  });

  it('las claves de los filtros son las que entiende el backend (`?situation=`): el agrupamiento NO se repite aquí', () => {
    expect(ISSUE_LIST_FILTERS.map((f) => f.key)).toEqual(['all', 'attention', 'waiting', 'resolved']);
  });
});

describe('describeNextStep', () => {
  const step = (over: Partial<NextStep>): NextStep => ({ kind: 'none', code: 'none', headline: 'x', label: 'x', ...over });
  const describeFor = (situation: IssueSituationKey, s: Partial<NextStep>) => describeNextStep(step(s), situation);

  it('esperando proveedor: quién y cuándo es el próximo seguimiento', () => {
    const at = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const text = describeFor('waiting_third_party', {
      kind: 'waiting',
      code: 'wait:provider_reply',
      label: 'Esperando respuesta de Ascensores Levante desde el 20 oct',
      at,
    });
    expect(text.text).toBe('Esperando respuesta de Ascensores Levante.');
    expect(text.when).toMatch(/^Próximo seguimiento: /);
  });

  it('un seguimiento vencido se dice como vencido', () => {
    const at = new Date(Date.now() - 86_400_000).toISOString();
    expect(describeFor('waiting_third_party', { kind: 'waiting', code: 'wait:insurer_reply', label: 'Esperando respuesta de el seguro', at }).when).toMatch(/^Seguimiento vencido: /);
  });

  it('visita programada, tarea humana, estancada y completada', () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    expect(describeFor('waiting_third_party', { kind: 'visit', code: 'visit_planned', label: 'Visita de Levante: jueves', at })).toMatchObject({ headline: 'Visita programada', text: 'Visita de Levante: jueves' });
    expect(describeFor('requires_attention', { kind: 'human', code: 'human_task', label: 'Aprobar consulta', at }).headline).toBe('Necesita tu intervención');
    expect(describeFor('stalled', { kind: 'none', code: 'stalled' }).headline).toBe('Sin siguiente paso');
    expect(describeFor('completed', { kind: 'completed', code: 'completed', label: 'La incidencia está resuelta.' }).headline).toBe('Resuelta');
    expect(describeFor('no_pending_action', { code: 'none' }).headline).toBe('Sin acción pendiente');
  });
});

describe('holderText y ageLabel', () => {
  it('la administración no lleva nombre; un tercero sí', () => {
    const base = { since: null, dueAt: null, refId: 'x', source: 'wait' as const };
    expect(holderText({ ...base, party: 'administration', label: 'Aprobar consulta' })).toBe('Administración');
    expect(holderText({ ...base, party: 'provider', label: 'Ascensores Levante' })).toBe('Proveedor · Ascensores Levante');
    expect(holderText({ ...base, party: 'insurer', label: null })).toBe('Seguro');
  });

  it('antigüedad legible', () => {
    const now = new Date('2026-10-23T12:00:00Z');
    expect(ageLabel('2026-10-23', now)).toBe('hoy');
    expect(ageLabel('2026-10-22', now)).toBe('hace 1 día');
    expect(ageLabel('2026-10-13', now)).toBe('hace 10 días');
    expect(ageLabel('2026-05-01', now)).toBe('hace 5 meses');
    expect(ageLabel('no-es-fecha', now)).toBe('');
  });
});
