import { buildActaSnapshot, type ActaSnapshotInput } from '../meetings/acta/acta-snapshot.service';
import type { ActaSourceSnapshot } from '../meetings/acta/acta-snapshot.types';

/** Entrada de snapshot de una junta realista: 4 propiedades, 3 presentes (una representada), 4 puntos. */
export function snapshotInput(overrides: Partial<ActaSnapshotInput> = {}): ActaSnapshotInput {
  return {
    now: new Date('2026-10-14T21:30:00Z'),
    meeting: {
      id: 'meeting-1',
      type: 'ordinaria',
      title: 'Junta ordinaria 2026',
      status: 'celebrada',
      scheduledAt1: new Date('2026-10-14T17:00:00Z'), // 19:00 en Madrid
      scheduledAt2: new Date('2026-10-14T17:30:00Z'), // 19:30
      location: 'Salón de actos',
      effectiveConvocation: 'primera',
      actualStartAt: new Date('2026-10-14T17:10:00Z'), // 19:10
      actualEndAt: new Date('2026-10-14T19:05:00Z'), // 21:05
      celebratedAt: new Date('2026-10-14T19:20:00Z'),
      agenda: [
        {
          id: 'a1',
          title: 'Aprobación del presupuesto 2027',
          description: 'Presupuesto anual',
          hasVote: true,
          comments: 'Se presenta el presupuesto. Intervino la propiedad 1B.',
          voteTemplate: { questions: [{ title: '¿Aprueba el presupuesto?', type: 'single_choice', options: ['A favor', 'En contra', 'Abstención'], majorityType: 'mayoriaSimple' }] },
        },
        { id: 'a2', title: 'Ruegos y preguntas', comments: 'Se pide revisar la iluminación del portal.' },
        { id: 'a3', title: 'Informe del administrador', treatedAt: '2026-10-14T18:30:00Z' },
        { id: 'a4', title: 'Cambio de cerradura', hasVote: true, voteTemplate: { questions: [{ title: '¿Se cambia?', type: 'single_choice', options: ['Sí', 'No'] }] } },
      ],
      actaGeneralComments: 'La junta se desarrolló con normalidad.',
      actaNextSteps: 'Solicitar 3 presupuestos.\n\nRevisar la iluminación.',
    },
    estate: { name: 'Comunidad Sol 12', address: 'Calle Mayor', streetNumber: '12', location: 'Madrid' },
    properties: [
      { id: 'p1', ref: '1A', floor: '1', door: 'A', participationQuota: '2.50' },
      { id: 'p2', ref: '1B', floor: '1', door: 'B', participationQuota: '2.90' },
      { id: 'p3', ref: '2A', floor: '2', door: 'A', participationQuota: '3.10' },
      { id: 'p4', ref: '2B', floor: '2', door: 'B', participationQuota: null },
    ],
    attendedPropertyIds: new Set(['p1', 'p3']),
    delegatedPropertyIds: new Set(['p2']),
    attendeeNamesByProperty: new Map([
      ['p1', 'Mónica Prieto Ruiz'],
      ['p2', 'Luis Gómez Pardo, en representación de Ana Ruiz Soto'],
      ['p3', 'Pedro Sanz Vega'],
    ]),
    attendeeDniByProperty: new Map([
      ['p1', '12345678Z'],
      ['p2', '87654321X'],
      ['p3', '11223344B'],
    ]),
    voteSessions: [
      {
        id: 's1',
        agendaItemId: 'a1',
        questionIndex: 0,
        majorityType: 'mayoriaSimple',
        closedAt: new Date('2026-10-14T18:00:00Z'),
        responseCount: 3,
        resultSummary: {
          passed: true,
          denominatorBasis: 'presentes',
          ownersFavorablePct: 66.67,
          quotaFavorablePct: 63.2,
          ownersDenominatorCount: 3,
          quotaDenominatorTotal: 8.5,
          optionTally: [
            { optionIndex: 0, propertyCount: 2 },
            { optionIndex: 1, propertyCount: 1 },
          ],
        },
      },
    ],
    ...overrides,
  };
}

export function sampleSnapshot(overrides: Partial<ActaSnapshotInput> = {}): ActaSourceSnapshot {
  return buildActaSnapshot(snapshotInput(overrides));
}
