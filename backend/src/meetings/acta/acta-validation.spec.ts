import { validateActaPreparation, type ActaValidationInput } from './acta-validation';

const input = (over: Partial<ActaValidationInput> = {}, meeting: Partial<ActaValidationInput['meeting']> = {}): ActaValidationInput => ({
  meeting: {
    status: 'celebrada',
    scheduledAt1: new Date('2026-10-14T17:00:00Z'),
    scheduledAt2: new Date('2026-10-14T17:30:00Z'),
    celebratedAt: new Date('2026-10-14T19:20:00Z'),
    actualStartAt: new Date('2026-10-14T17:10:00Z'),
    actualEndAt: new Date('2026-10-14T19:05:00Z'),
    effectiveConvocation: 'primera',
    location: 'Salón',
    agenda: [{ id: 'a1', title: 'Cuentas', comments: 'Nota' }],
    ...meeting,
  },
  openVoteSessions: 0,
  closedVoteSessions: [],
  censusCount: 10,
  missingQuotaCount: 0,
  presentCount: 6,
  hasVersion: false,
  ...over,
});
const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('validateActaPreparation', () => {
  it('con todo confirmado y coherente se puede generar; preparar para firma exige además una versión', () => {
    const ok = validateActaPreparation(input());
    expect(ok).toMatchObject({ canGenerate: true, canPrepareForSignature: false, errors: [], missingFields: [] });
    expect(validateActaPreparation(input({ hasVersion: true })).canPrepareForSignature).toBe(true);
  });

  it('ERROR: faltan los tres datos de la reunión, que se listan como campos pendientes', () => {
    const result = validateActaPreparation(input({}, { actualStartAt: null, actualEndAt: null, effectiveConvocation: null }));
    expect(result.canGenerate).toBe(false);
    expect(result.missingFields).toEqual(['effectiveConvocation', 'actualStartAt', 'actualEndAt']);
    expect(codes(result.errors)).toEqual(['MISSING_EFFECTIVE_CONVOCATION', 'MISSING_ACTUAL_START', 'MISSING_ACTUAL_END']);
  });

  it('la hora de fin no se deduce de «celebrada»: solo se ofrece como referencia', () => {
    const result = validateActaPreparation(input({}, { actualEndAt: null }));
    expect(result.confirmed.actualEndAt).toBeNull();
    expect(result.reference.celebratedAt).toBe('2026-10-14T19:20:00.000Z');
    expect(result.missingFields).toContain('actualEndAt');
  });

  it('ERROR: la hora de fin debe ser posterior a la de inicio', () => {
    const result = validateActaPreparation(input({}, { actualEndAt: new Date('2026-10-14T17:00:00Z') }));
    expect(codes(result.errors)).toEqual(['TIME_ORDER']);
  });

  it.each([
    ['convocada', 'MEETING_NOT_HELD'],
    ['cancelada', 'MEETING_CANCELLED'],
    ['firmada', 'ALREADY_SIGNED'],
  ])('ERROR: una junta %s no se puede preparar', (status, code) => {
    expect(codes(validateActaPreparation(input({}, { status })).errors)).toContain(code);
  });

  it('ERROR: votaciones abiertas bloquean; las cerradas no', () => {
    expect(codes(validateActaPreparation(input({ openVoteSessions: 2 })).errors)).toEqual(['VOTES_OPEN']);
    expect(validateActaPreparation(input({ closedVoteSessions: [{ agendaItemId: 'a1', questionIndex: 0 }] })).errors).toEqual([]);
  });

  it('ERROR: sin censo no se puede reproducir la asistencia', () => {
    expect(codes(validateActaPreparation(input({ censusCount: 0, presentCount: 0 })).errors)).toContain('NO_CENSUS');
  });

  it('WARNING: propiedades sin coeficiente no bloquean', () => {
    const result = validateActaPreparation(input({ missingQuotaCount: 2 }));
    expect(result.canGenerate).toBe(true);
    expect(codes(result.warnings)).toEqual(['MISSING_QUOTA']);
  });

  it('WARNING: sin asistencia registrada, sin lugar y sin puntos', () => {
    const result = validateActaPreparation(input({ presentCount: 0 }, { location: null, agenda: [] }));
    expect(result.canGenerate).toBe(true);
    expect(codes(result.warnings)).toEqual(expect.arrayContaining(['NO_ATTENDANCE', 'NO_LOCATION', 'AGENDA_EMPTY']));
  });

  it('WARNING: puntos que no constan como tratados y votaciones de puntos que ya no existen', () => {
    const result = validateActaPreparation(
      input({ closedVoteSessions: [{ agendaItemId: 'borrado', questionIndex: 0 }] }, { agenda: [{ id: 'a1', title: 'Cuentas' }, { id: 'a2', title: 'Ruegos', comments: 'Algo' }] }),
    );
    expect(codes(result.warnings)).toEqual(expect.arrayContaining(['ITEMS_NOT_TREATED', 'VOTE_WITHOUT_AGENDA_ITEM']));
    expect(result.warnings.find((warning) => warning.code === 'ITEMS_NOT_TREATED')?.message).toContain('«Cuentas»');
  });

  it('WARNING: inicio anterior a la primera convocatoria', () => {
    const result = validateActaPreparation(input({}, { actualStartAt: new Date('2026-10-14T16:00:00Z') }));
    expect(codes(result.warnings)).toContain('START_BEFORE_FIRST_CALL');
    expect(result.canGenerate).toBe(true);
  });
});
