import { buildActaSnapshot } from './acta-snapshot.service';
import { actaContentHash } from './acta-hash';
import { buildActaDocument } from './acta-document.builder';
import { sampleSnapshot, snapshotInput } from '../../testing/acta-fixtures';

describe('buildActaSnapshot — congela la realidad de la junta', () => {
  it('recoge junta, comunidad, censo, quórum y agenda con valores, no con referencias', () => {
    const snapshot = sampleSnapshot();
    expect(snapshot.meeting).toMatchObject({
      id: 'meeting-1',
      type: 'ordinaria',
      location: 'Salón de actos',
      effectiveConvocation: 'primera',
      actualStartAt: '2026-10-14T17:10:00.000Z',
      actualEndAt: '2026-10-14T19:05:00.000Z',
    });
    expect(snapshot.community).toEqual({
      name: 'Comunidad Sol 12',
      address: 'Calle Mayor 12',
      locality: 'Madrid',
    });
    expect(snapshot.census).toEqual({
      propertyCount: 4,
      totalQuota: 8.5,
      missingQuotaCount: 1,
    });
    expect(snapshot.quorum).toMatchObject({
      convocatoria: 'primera',
      quorumRequired: true,
      owners: { present: 3, total: 4 },
    });
    expect(
      snapshot.agenda.map((item) => [item.order, item.id, item.title]),
    ).toEqual([
      [1, 'a1', 'Aprobación del presupuesto 2027'],
      [2, 'a2', 'Ruegos y preguntas'],
      [3, 'a3', 'Informe del administrador'],
      [4, 'a4', 'Cambio de cerradura'],
    ]);
    expect(snapshot.text).toEqual({
      generalComments: 'La junta se desarrolló con normalidad.',
      nextSteps: 'Solicitar 3 presupuestos.\n\nRevisar la iluminación.',
    });
  });

  it('asistencia: solo presentes o representadas, con el coeficiente de ese momento, el nombre completo y el DNI de quien asistió', () => {
    const snapshot = sampleSnapshot();
    expect(snapshot.attendance).toEqual([
      {
        propertyId: 'p1',
        ref: '1A',
        participationQuota: '2.50',
        status: 'presente',
        attendeeName: 'Mónica Prieto Ruiz',
        attendeeDni: '12345678Z',
      },
      {
        propertyId: 'p2',
        ref: '1B',
        participationQuota: '2.90',
        status: 'representada',
        attendeeName: 'Luis Gómez Pardo, en representación de Ana Ruiz Soto',
        attendeeDni: '87654321X',
      },
      {
        propertyId: 'p3',
        ref: '2A',
        participationQuota: '3.10',
        status: 'presente',
        attendeeName: 'Pedro Sanz Vega',
        attendeeDni: '11223344B',
      },
    ]);
    // Se identifica a quien asistió (nombre y DNI), pero no se congelan emails.
    expect(JSON.stringify(snapshot)).not.toMatch(/email|@/i);
  });

  it('sin nombres conocidos la asistencia se congela igualmente, sin nombre', () => {
    const snapshot = sampleSnapshot({
      attendeeNamesByProperty: undefined,
      attendeeDniByProperty: undefined,
    });
    expect(
      snapshot.attendance.map((row) => [row.attendeeName, row.attendeeDni]),
    ).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
  });

  it('una delegación vigente cuenta como representada aunque la propiedad también tuviera asistencia', () => {
    const snapshot = sampleSnapshot({
      attendedPropertyIds: new Set(['p1', 'p2']),
      delegatedPropertyIds: new Set(['p2']),
    });
    expect(
      snapshot.attendance.find((row) => row.propertyId === 'p2')?.status,
    ).toBe('representada');
  });

  it('votación: recuento por opción con el texto literal, porcentajes, mayoría y resultado', () => {
    const [vote] = sampleSnapshot().votes;
    expect(vote).toMatchObject({
      voteSessionId: 's1',
      agendaItemId: 'a1',
      majorityType: 'mayoriaSimple',
      passed: true,
      denominatorBasis: 'presentes',
      ownersFavorablePct: 66.67,
      quotaFavorablePct: 63.2,
      totalResponses: 3,
    });
    expect(vote.options).toEqual([
      { optionIndex: 0, label: 'A favor', count: 2, percent: 66.67 },
      { optionIndex: 1, label: 'En contra', count: 1, percent: 33.33 },
      { optionIndex: 2, label: 'Abstención', count: 0, percent: 0 },
    ]);
  });

  it('es inmune a cambios posteriores de Property: coeficiente, referencia y censo', () => {
    const input = snapshotInput();
    const snapshot = buildActaSnapshot(input);
    const before = JSON.stringify(snapshot);
    const hashBefore = actaContentHash(
      buildActaDocument(snapshot, { items: {}, observations: null }),
    );

    // Después de generar el acta: cambia un coeficiente, una referencia y se da de baja una propiedad.
    input.properties[0].participationQuota = '9.99';
    input.properties[0].ref = '1Z';
    input.properties.pop();

    expect(JSON.stringify(snapshot)).toBe(before);
    expect(
      actaContentHash(
        buildActaDocument(snapshot, { items: {}, observations: null }),
      ),
    ).toBe(hashBefore);
    // Y un snapshot nuevo, con los datos nuevos, sí cambia: lo que se congeló es lo antiguo.
    expect(
      buildActaSnapshot(input).attendance.find(
        (row) => row.propertyId === 'p1',
      ),
    ).toMatchObject({ ref: '1Z', participationQuota: '9.99' });
  });

  it('es inmune a delegaciones modificadas o revocadas después', () => {
    const input = snapshotInput();
    const snapshot = buildActaSnapshot(input);
    const before = JSON.stringify(snapshot.attendance);
    input.delegatedPropertyIds.delete('p2'); // se revoca la delegación
    input.attendedPropertyIds.add('p4');
    expect(JSON.stringify(snapshot.attendance)).toBe(before);
    expect(
      snapshot.attendance.find((row) => row.propertyId === 'p2')?.status,
    ).toBe('representada');
  });

  it('es inmune a cambios posteriores del resultado de la votación (copia profunda)', () => {
    const input = snapshotInput();
    const snapshot = buildActaSnapshot(input);
    (input.voteSessions[0].resultSummary as { passed: boolean }).passed = false;
    expect(snapshot.votes[0].passed).toBe(true);
    expect(
      (snapshot.votes[0].resultSummary as { passed: boolean }).passed,
    ).toBe(true);
  });

  it('primera y segunda convocatoria salen de la CONFIRMADA, no de la hora ni del instante de generación', () => {
    const first = sampleSnapshot();
    expect(first.quorum.convocatoria).toBe('primera');
    // Mismo meeting, generado meses después (now muy posterior a la 2ª convocatoria) y confirmada la segunda.
    const input = snapshotInput({ now: new Date('2027-05-01T10:00:00Z') });
    input.meeting.effectiveConvocation = 'segunda';
    const second = buildActaSnapshot(input);
    expect(second.quorum).toMatchObject({
      convocatoria: 'segunda',
      quorumRequired: false,
      quorumMet: true,
    });
    expect(second.meeting.effectiveConvocation).toBe('segunda');
  });

  it('sin hora real de inicio o de fin, el snapshot guarda null (no inventa nada)', () => {
    const input = snapshotInput();
    input.meeting.actualStartAt = null;
    input.meeting.actualEndAt = null;
    const snapshot = buildActaSnapshot(input);
    expect(snapshot.meeting.actualStartAt).toBeNull();
    expect(snapshot.meeting.actualEndAt).toBeNull();
    // celebratedAt es solo una referencia: no se copia a actualEndAt.
    expect(snapshot.meeting.celebratedAt).toBe('2026-10-14T19:20:00.000Z');
  });

  it('opciones personalizadas: se conserva el texto literal de cada opción', () => {
    const input = snapshotInput();
    (
      input.meeting.agenda as {
        voteTemplate: { questions: { options: string[] }[] };
      }[]
    )[0].voteTemplate.questions[0].options = [
      'Opción A',
      'Opción B',
      'Opción C',
    ];
    const [vote] = buildActaSnapshot(input).votes;
    expect(vote.options.map((option) => option.label)).toEqual([
      'Opción A',
      'Opción B',
      'Opción C',
    ]);
  });

  it('selección múltiple o resultado sin veredicto: passed queda en null', () => {
    const input = snapshotInput();
    input.voteSessions[0].resultSummary = {
      passed: null,
      optionTally: [{ optionIndex: 0, propertyCount: 2 }],
    };
    expect(buildActaSnapshot(input).votes[0].passed).toBeNull();
  });

  it('omite las votaciones cuyo punto o pregunta ya no existen, y las preguntas de texto libre', () => {
    const input = snapshotInput();
    input.voteSessions.push({
      ...input.voteSessions[0],
      id: 's-huerfana',
      agendaItemId: 'no-existe',
    });
    expect(
      buildActaSnapshot(input).votes.map((vote) => vote.voteSessionId),
    ).toEqual(['s1']);
  });

  it('propiedad sin ref usa planta y puerta, como en la pantalla de participación', () => {
    const input = snapshotInput();
    input.properties[0].ref = null;
    expect(buildActaSnapshot(input).attendance[0].ref).toBe('1A');
  });
});
