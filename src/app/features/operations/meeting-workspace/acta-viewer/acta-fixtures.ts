import type { ActaDocumentModel, ActaValidation, ActaVersionView } from '../../../../core/acta.models';

const src = (fields: string[] = []) => ({ fields });
const block = (text: string, origin: 'generated' | 'notes' | 'edited' = 'notes') => ({ text, origin, source: src() });

/** Documento de acta tal y como lo devuelve el backend: 3 puntos (votado, tratado sin contenido, no tratado). */
export function actaDocument(over: Partial<ActaDocumentModel> = {}): ActaDocumentModel {
  return {
    schemaVersion: 1,
    header: {
      title: 'ACTA DE LA JUNTA GENERAL ORDINARIA',
      subtitle: 'DE LA COMUNIDAD DE PROPIETARIOS',
      communityName: 'Comunidad Sol 12',
      address: 'Calle Mayor 12, Madrid',
      meetingType: 'ordinaria',
      source: src(),
    },
    constitution: {
      paragraph:
        'En Madrid, siendo las 19:10 horas del día 14 de octubre de 2026, se reúnen en Salón de actos, en primera convocatoria, los propietarios presentes o representados de la comunidad de propietarios Comunidad Sol 12.',
      introduction: block('', 'edited'),
      facts: { dateLabel: '14 de octubre de 2026', startTime: '19:10', convocation: 'primera', location: 'Salón de actos', locality: 'Madrid' },
      source: src(),
    },
    labels: { agenda: 'ORDEN DEL DÍA', attendance: 'ASISTENCIA', development: 'DESARROLLO', attendanceColumns: ['PROPIEDAD', 'ASISTENTE', 'DNI', 'COEFICIENTE', 'ASISTENCIA'] },
    agenda: [
      { order: 1, label: '1º', title: 'Aprobación del presupuesto 2027', line: '1º  Aprobación del presupuesto 2027', source: src() },
      { order: 2, label: '2º', title: 'Ruegos y preguntas', line: '2º  Ruegos y preguntas', source: src() },
      { order: 3, label: '3º', title: 'Cambio de cerradura', line: '3º  Cambio de cerradura', source: src() },
    ],
    attendance: {
      summary: {
        presentCount: 3,
        totalCount: 4,
        representedCount: 1,
        propertiesPercent: '75,00 %',
        quotaPercent: '100,00 %',
        sentence: 'Asisten, presentes o representadas, 3 de 4 propiedades (75,00 % de las propiedades), que representan el 100,00 % del coeficiente de participación.',
      },
      rows: [
        { ref: '1A', attendee: 'Mónica Prieto Ruiz', attendeeDni: '12345678Z', quota: '2,50 %', status: 'Presente' },
        { ref: '1B', attendee: 'Luis Gómez Pardo, en representación de Ana Ruiz Soto', attendeeDni: '87654321X', quota: '2,90 %', status: 'Representada' },
        { ref: '2A', attendee: 'Pedro Sanz Vega', attendeeDni: '11223344B', quota: '3,10 %', status: 'Presente' },
      ],
      source: src(),
    },
    items: [
      {
        id: 'a1',
        order: 1,
        label: '1º',
        title: 'Aprobación del presupuesto 2027',
        headingText: '1º  APROBACIÓN DEL PRESUPUESTO 2027',
        description: null,
        state: 'voted',
        stateText: null,
        narrative: block('Se presenta el presupuesto anual.', 'generated'),
        votes: [
          {
            voteSessionId: 's1',
            question: '¿Aprueba el presupuesto?',
            options: [
              { label: 'Opción A', count: 2 },
              { label: 'Opción B', count: 1 },
              { label: 'Opción C', count: 0 },
            ],
            totalResponses: 3,
            majority: { type: 'mayoriaSimple', label: 'Mayoría simple' },
            favorable: { owners: '66,67 %', quota: '63,20 %', basis: 'presentes' },
            outcome: 'approved',
            outcomeText: 'La propuesta resulta aprobada.',
            lines: {
              question: 'Propuesta sometida a votación: «¿Aprueba el presupuesto?»',
              options: ['Opción A: 2', 'Opción B: 1', 'Opción C: 0'],
              majority: 'Mayoría aplicada: Mayoría simple.',
              favorable: 'A favor: 66,67 % de las propiedades y 63,20 % del coeficiente (sobre las propiedades presentes).',
              outcome: 'La propuesta resulta aprobada.',
            },
            source: src(),
          },
        ],
        agreements: [
          { id: 'agreement-s1', itemId: 'a1', text: 'Se aprueba la propuesta sometida a votación.', line: 'ACUERDO: Se aprueba la propuesta sometida a votación.', source: src() },
        ],
        source: src(),
      },
      {
        id: 'a2',
        order: 2,
        label: '2º',
        title: 'Ruegos y preguntas',
        headingText: '2º  RUEGOS Y PREGUNTAS',
        description: null,
        state: 'treated',
        stateText: 'El punto quedó tratado sin contenido adicional registrado.',
        narrative: block('', 'notes'),
        votes: [],
        agreements: [],
        source: src(),
      },
      {
        id: 'a3',
        order: 3,
        label: '3º',
        title: 'Cambio de cerradura',
        headingText: '3º  CAMBIO DE CERRADURA',
        description: null,
        state: 'not-treated',
        stateText: 'Este punto no consta como tratado en la reunión.',
        narrative: block('', 'notes'),
        votes: [],
        agreements: [],
        source: src(),
      },
    ],
    agreements: [
      { id: 'agreement-s1', itemId: 'a1', text: 'Se aprueba la propuesta sometida a votación.', line: 'ACUERDO: Se aprueba la propuesta sometida a votación.', source: src() },
    ],
    observations: { ...block('La junta se desarrolló con normalidad.'), title: 'OBSERVACIONES' },
    nextSteps: { ...block('Solicitar 3 presupuestos.\nRevisar la iluminación.'), title: 'ACTUACIONES DERIVADAS DE LOS ACUERDOS' },
    closing: { paragraph: 'Y no habiendo más asuntos que tratar, se levanta la sesión a las 21:05 horas.', source: src() },
    signatures: {
      blocks: [
        { role: 'presidente', lines: ['Vº Bº', 'EL/LA PRESIDENTE/A'] },
        { role: 'secretario', lines: ['EL/LA SECRETARIO/A-ADMINISTRADOR/A'] },
      ],
    },
    missing: [],
    ...over,
  };
}

export function actaVersion(over: Partial<ActaVersionView> = {}): ActaVersionView {
  return {
    id: 'v3',
    versionNumber: 3,
    status: 'draft',
    statusLabel: 'Borrador',
    createdAt: '2026-10-14T21:40:00Z',
    generatedAt: '2026-10-14T21:40:00Z',
    preparedAt: null,
    savedByName: 'Ana Gestora',
    versionHash: 'a'.repeat(64),
    hasPdf: false,
    snapshotCapturedAt: '2026-10-14T21:30:00Z',
    narrative: { mode: 'fallback', model: null, reason: 'Redacción automática desactivada.' },
    notesChanged: false,
    editable: true,
    document: actaDocument(),
    ...over,
  };
}

export function actaValidation(over: Partial<ActaValidation> = {}): ActaValidation {
  return {
    canGenerate: false,
    canPrepareForSignature: false,
    errors: [],
    warnings: [],
    missingFields: ['effectiveConvocation', 'actualStartAt', 'actualEndAt'],
    confirmed: { actualStartAt: null, actualEndAt: null, effectiveConvocation: null },
    reference: { scheduledAt1: '2026-10-14T17:00:00Z', scheduledAt2: '2026-10-14T17:30:00Z', celebratedAt: '2026-10-14T19:20:00Z' },
    hasVersion: false,
    ...over,
  };
}
