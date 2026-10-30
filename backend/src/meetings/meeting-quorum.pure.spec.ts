import { buildQuorum, resolveConvocation } from './meeting-quorum.service';

const SCHEDULED_2 = new Date('2026-10-14T19:30:00Z');
const base = { scheduledAt2: SCHEDULED_2, effectiveConvocation: null, celebratedAt: null };

describe('resolveConvocation — la hora actual no decide el pasado', () => {
  it('una junta convocada y en curso se resuelve por la hora actual', () => {
    expect(resolveConvocation({ ...base, status: 'convocada' }, { now: new Date('2026-10-14T19:00:00Z') })).toEqual({ call: 'primera', source: 'now' });
    expect(resolveConvocation({ ...base, status: 'convocada' }, { now: new Date('2026-10-14T19:45:00Z') })).toEqual({ call: 'segunda', source: 'now' });
  });

  it('una junta celebrada con convocatoria confirmada usa la confirmada, ahora sea cuando sea', () => {
    const meeting = { ...base, status: 'celebrada', effectiveConvocation: 'primera' as const, celebratedAt: new Date('2026-10-14T21:00:00Z') };
    // Meses después (mucho más tarde que la 2ª convocatoria) sigue siendo 1ª: lo confirmado manda.
    expect(resolveConvocation(meeting, { now: new Date('2027-03-01T10:00:00Z') })).toEqual({ call: 'primera', source: 'confirmed' });
    // También sobre una hora `at` que apuntaría a la otra.
    expect(resolveConvocation(meeting, { at: new Date('2030-01-01T00:00:00Z') })).toEqual({ call: 'primera', source: 'confirmed' });
  });

  it('confirmada la segunda, es segunda aunque se mire antes de su hora', () => {
    const meeting = { ...base, status: 'celebrada', effectiveConvocation: 'segunda' as const };
    expect(resolveConvocation(meeting, { at: new Date('2026-10-14T10:00:00Z') })).toEqual({ call: 'segunda', source: 'confirmed' });
  });

  it('una convocatoria indicada expresamente gana a todo', () => {
    const meeting = { ...base, status: 'celebrada', effectiveConvocation: 'primera' as const };
    expect(resolveConvocation(meeting, { override: 'segunda' })).toEqual({ call: 'segunda', source: 'explicit' });
  });

  it('una junta cerrada SIN confirmar se deduce del instante en que se marcó celebrada, no de ahora', () => {
    const meeting = { ...base, status: 'celebrada', celebratedAt: new Date('2026-10-14T19:10:00Z') };
    expect(resolveConvocation(meeting, { now: new Date('2027-01-01T00:00:00Z') })).toEqual({ call: 'primera', source: 'celebratedAt' });
    const late = { ...base, status: 'firmada', celebratedAt: new Date('2026-10-14T20:00:00Z') };
    expect(resolveConvocation(late, { now: new Date('2026-10-14T19:00:00Z') })).toEqual({ call: 'segunda', source: 'celebratedAt' });
  });

  it('sin ningún dato, una junta cerrada se marca como deducida de la 2ª convocatoria', () => {
    expect(resolveConvocation({ ...base, status: 'cancelada' })).toEqual({ call: 'segunda', source: 'scheduledAt2' });
  });
});

describe('buildQuorum — cálculo puro sobre datos congelados', () => {
  const census = [
    { id: 'p1', ref: '1A', participationQuota: '40' },
    { id: 'p2', ref: '1B', participationQuota: '30' },
    { id: 'p3', ref: '2A', participationQuota: '20' },
    { id: 'p4', ref: '2B', participationQuota: null },
  ];

  it('1ª convocatoria: exige doble mayoría estricta de propietarios y cuotas', () => {
    const met = buildQuorum({ call: 'primera', source: 'confirmed', properties: census, presentIds: new Set(['p1', 'p2', 'p3']) });
    expect(met).toMatchObject({ convocatoria: 'primera', convocatoriaSource: 'confirmed', quorumRequired: true, quorumMet: true });
    expect(met.owners).toEqual({ present: 3, total: 4, percent: 75 });
    expect(met.quota).toEqual({ present: 90, total: 90, percent: 100 });
    // 2 de 4 propietarios = 50 %: no es mayoría estricta aunque las cuotas sí lo sean (70/90).
    const notMet = buildQuorum({ call: 'primera', source: 'confirmed', properties: census, presentIds: new Set(['p1', 'p2']) });
    expect(notMet.quorumMet).toBe(false);
  });

  it('2ª convocatoria: no hay quórum exigible, ni con nadie presente', () => {
    const result = buildQuorum({ call: 'segunda', source: 'confirmed', properties: census, presentIds: new Set() });
    expect(result).toMatchObject({ quorumRequired: false, quorumMet: true });
    expect(result.owners.present).toBe(0);
  });

  it('avisa de las propiedades sin coeficiente y conserva el coeficiente como texto', () => {
    const result = buildQuorum({ call: 'primera', source: 'now', properties: census, presentIds: new Set(['p1']) });
    expect(result.missingParticipationQuotaCount).toBe(1);
    expect(result.attendingProperties).toEqual([{ propertyId: 'p1', ref: '1A', participationQuota: '40', attendeeNames: [] }]);
  });

  it('el resultado no cambia si luego cambian los objetos de origen (valores copiados, no referencias)', () => {
    const properties = census.map((p) => ({ ...p }));
    const first = buildQuorum({ call: 'primera', source: 'confirmed', properties, presentIds: new Set(['p1', 'p2', 'p3']) });
    properties[0].participationQuota = '5';
    expect(first.quota.present).toBe(90);
  });
});
