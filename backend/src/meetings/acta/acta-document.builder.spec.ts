import { ACTA_PHRASES, buildActaDocument, type ActaTexts } from './acta-document.builder';
import { actaContentHash, canonicalJson } from './acta-hash';
import { sampleSnapshot, snapshotInput } from '../../testing/acta-fixtures';
import type { ActaSourceSnapshot } from './acta-snapshot.types';

const noTexts: ActaTexts = { items: {}, observations: null };
const texts: ActaTexts = {
  items: {
    a1: { text: 'Se presenta el presupuesto anual.', origin: 'generated' },
    a2: { text: 'Se pide revisar la iluminación del portal.', origin: 'notes' },
  },
  observations: { text: 'La junta se desarrolló con normalidad.', origin: 'notes' },
};
const build = (snapshot: ActaSourceSnapshot = sampleSnapshot(), t: ActaTexts = texts) => buildActaDocument(snapshot, t);

describe('buildActaDocument — fuente única del contenido del acta', () => {
  describe('encabezado y constitución', () => {
    it('ordinaria: título formal, comunidad y dirección', () => {
      const model = build();
      expect(model.header).toMatchObject({ title: 'ACTA DE LA JUNTA GENERAL ORDINARIA', subtitle: 'DE LA COMUNIDAD DE PROPIETARIOS', communityName: 'Comunidad Sol 12', address: 'Calle Mayor 12, Madrid' });
    });

    it('extraordinaria usa Meeting.type', () => {
      const input = snapshotInput();
      input.meeting.type = 'extraordinaria';
      expect(build(sampleSnapshot(input)).header.title).toBe('ACTA DE LA JUNTA GENERAL EXTRAORDINARIA');
    });

    it('primera convocatoria: hora real, fecha, lugar y comunidad (hora de Madrid, no la del servidor)', () => {
      const { paragraph, facts } = build().constitution;
      expect(paragraph).toBe(
        'En Madrid, siendo las 19:10 horas del día 14 de octubre de 2026, se reúnen en Salón de actos, en primera convocatoria, ' +
          'los propietarios presentes o representados de la comunidad de propietarios Comunidad Sol 12, sita en Calle Mayor 12, ' +
          'al objeto de celebrar la Junta General Ordinaria conforme al siguiente orden del día.',
      );
      expect(facts).toMatchObject({ startTime: '19:10', convocation: 'primera' });
    });

    it('segunda convocatoria', () => {
      const input = snapshotInput();
      input.meeting.effectiveConvocation = 'segunda';
      expect(build(sampleSnapshot(input)).constitution.paragraph).toContain('en segunda convocatoria');
    });

    it('sin hora real de inicio: no se inventa la hora, se omite y se anota como dato que falta', () => {
      const input = snapshotInput();
      input.meeting.actualStartAt = null;
      const model = build(sampleSnapshot(input));
      expect(model.constitution.paragraph).not.toMatch(/siendo las/);
      expect(model.constitution.paragraph).toMatch(/^En Madrid, el día 14 de octubre de 2026,/);
      expect(model.missing).toContain('actualStartAt');
    });

    it('sin localidad ni lugar, esas partes se omiten sin inventar nada', () => {
      const input = snapshotInput();
      input.estate.location = null;
      input.meeting.location = null;
      const { paragraph } = build(sampleSnapshot(input)).constitution;
      expect(paragraph.startsWith('Siendo las 19:10 horas')).toBe(true);
      expect(paragraph).toContain('se reúnen en primera convocatoria');
      expect(paragraph).not.toMatch(/presidente|secretario/i);
    });
  });

  describe('orden del día y asistencia', () => {
    it('numera y titula los puntos exactamente como están en la agenda', () => {
      expect(build().agenda.map((entry) => `${entry.label} ${entry.title}`)).toEqual([
        '1º Aprobación del presupuesto 2027',
        '2º Ruegos y preguntas',
        '3º Informe del administrador',
        '4º Cambio de cerradura',
      ]);
    });

    it('resumen y filas: presente / representada con el coeficiente congelado y el nombre completo y el DNI del asistente', () => {
      const { attendance } = build();
      expect(attendance.summary).toMatchObject({ presentCount: 3, totalCount: 4, representedCount: 1, propertiesPercent: '75,00 %' });
      expect(attendance.summary.sentence).toContain('Asisten, presentes o representadas, 3 de 4 propiedades (75,00 % de las propiedades)');
      expect(attendance.rows).toEqual([
        { ref: '1A', attendee: 'Mónica Prieto Ruiz', attendeeDni: '12345678Z', quota: '2,50 %', status: 'Presente' },
        { ref: '1B', attendee: 'Luis Gómez Pardo, en representación de Ana Ruiz Soto', attendeeDni: '87654321X', quota: '2,90 %', status: 'Representada' },
        { ref: '2A', attendee: 'Pedro Sanz Vega', attendeeDni: '11223344B', quota: '3,10 %', status: 'Presente' },
      ]);
      expect(build().labels.attendanceColumns).toEqual(['PROPIEDAD', 'ASISTENTE', 'DNI', 'COEFICIENTE', 'ASISTENCIA']);
    });

    it('si no consta el nombre ni el DNI de quien asistió, la fila lleva «—»', () => {
      const model = build(sampleSnapshot(snapshotInput({ attendeeNamesByProperty: undefined, attendeeDniByProperty: undefined })));
      expect(model.attendance.rows.map((row) => [row.attendee, row.attendeeDni])).toEqual([['—', '—'], ['—', '—'], ['—', '—']]);
    });

    it('una propiedad sin coeficiente aparece con «—» y se anota como dato que falta', () => {
      const input = snapshotInput({ attendedPropertyIds: new Set(['p1', 'p4']) });
      const model = build(sampleSnapshot(input));
      expect(model.attendance.rows.find((row) => row.ref === '2B')?.quota).toBe('—');
      expect(model.missing.some((entry) => entry.startsWith('participationQuota'))).toBe(true);
    });
  });

  describe('desarrollo de cada punto', () => {
    it('A) comentarios + votación: desarrollo redactado y resultado determinista', () => {
      const item = build().items[0];
      expect(item.state).toBe('voted');
      expect(item.narrative).toMatchObject({ text: 'Se presenta el presupuesto anual.', origin: 'generated' });
      expect(item.votes).toHaveLength(1);
      expect(item.votes[0].outcomeText).toBe(ACTA_PHRASES.approved);
    });

    it('B) sin comentarios + votación: no se inventa debate, solo la votación', () => {
      const input = snapshotInput();
      (input.meeting.agenda as { comments?: string }[])[0].comments = undefined;
      const item = build(sampleSnapshot(input), noTexts).items[0];
      expect(item.narrative.text).toBe('');
      expect(item.stateText).toBeNull();
      expect(item.votes).toHaveLength(1);
    });

    it('C) comentarios + sin votación: solo desarrollo', () => {
      const item = build().items[1];
      expect(item.state).toBe('treated');
      expect(item.narrative.text).toBe('Se pide revisar la iluminación del portal.');
      expect(item.votes).toEqual([]);
      expect(item.stateText).toBeNull();
    });

    it('D) sin comentarios ni votación pero con treatedAt: consta como tratado sin contenido', () => {
      const item = build().items[2];
      expect(item.state).toBe('treated');
      expect(item.stateText).toBe(ACTA_PHRASES.treatedWithoutContent);
      expect(item.narrative.text).toBe('');
    });

    it('E) punto no tratado (sin comentarios, votación ni marca): no se presenta como tratado', () => {
      const item = build().items[3];
      expect(item.state).toBe('not-treated');
      expect(item.stateText).toBe(ACTA_PHRASES.notTreated);
      expect(item.votes).toEqual([]);
      expect(item.agreements).toEqual([]);
    });

    it('un punto con votación pendiente pero con comentarios deja constancia de que no hay votación', () => {
      const input = snapshotInput();
      (input.meeting.agenda as { comments?: string }[])[3].comments = 'Se aplaza.';
      const item = build(sampleSnapshot(input), { ...texts, items: { ...texts.items, a4: { text: 'Se aplaza.', origin: 'notes' } } }).items[3];
      expect(item.state).toBe('treated');
      expect(item.stateText).toBe(ACTA_PHRASES.noVoteRecorded);
    });
  });

  describe('votaciones', () => {
    it('muestra las opciones reales con su recuento, la mayoría configurada y los porcentajes de la mayoría', () => {
      const [vote] = build().items[0].votes;
      expect(vote.question).toBe('¿Aprueba el presupuesto?');
      expect(vote.options).toEqual([
        { label: 'A favor', count: 2 },
        { label: 'En contra', count: 1 },
        { label: 'Abstención', count: 0 },
      ]);
      expect(vote.majority).toEqual({ type: 'mayoriaSimple', label: 'Mayoría simple' });
      expect(vote.favorable).toEqual({ owners: '66,67 %', quota: '63,20 %', basis: 'presentes' });
      // Las líneas ya redactadas son lo que pintan el visor, el PDF y el .docx.
      expect(vote.lines).toEqual({
        question: 'Propuesta sometida a votación: «¿Aprueba el presupuesto?»',
        options: ['A favor: 2', 'En contra: 1', 'Abstención: 0'],
        majority: 'Mayoría aplicada: Mayoría simple.',
        favorable: 'A favor: 66,67 % de las propiedades y 63,20 % del coeficiente (sobre las propiedades presentes).',
        outcome: 'La propuesta resulta aprobada.',
      });
    });

    it('opciones personalizadas: se muestran literalmente, sin asumir que el índice 1 es «en contra»', () => {
      const input = snapshotInput();
      (input.meeting.agenda as { voteTemplate: { questions: { options: string[] }[] } }[])[0].voteTemplate.questions[0].options = ['Opción A', 'Opción B', 'Opción C'];
      const [vote] = build(sampleSnapshot(input)).items[0].votes;
      expect(vote.options.map((option) => option.label)).toEqual(['Opción A', 'Opción B', 'Opción C']);
      expect(JSON.stringify(vote)).not.toMatch(/en contra|abstenci/i);
    });

    it('passed true: aprobada y se genera el acuerdo determinista, trazable a su votación', () => {
      const model = build();
      expect(model.items[0].votes[0].outcome).toBe('approved');
      expect(model.agreements).toEqual([
        { id: 'agreement-s1', itemId: 'a1', text: ACTA_PHRASES.agreement, line: `ACUERDO: ${ACTA_PHRASES.agreement}`, source: { agendaItemId: 'a1', voteSessionIds: ['s1'], fields: ['voteSession.passed', 'voteSession.resultSummary'] } },
      ]);
    });

    it('passed false: rechazada y sin acuerdo', () => {
      const input = snapshotInput();
      (input.voteSessions[0].resultSummary as { passed: boolean }).passed = false;
      const model = build(sampleSnapshot(input));
      expect(model.items[0].votes[0]).toMatchObject({ outcome: 'rejected', outcomeText: ACTA_PHRASES.rejected });
      expect(model.agreements).toEqual([]);
    });

    it('passed null: no se inventa aprobado ni rechazado ni acuerdo', () => {
      const input = snapshotInput();
      (input.voteSessions[0].resultSummary as { passed: boolean | null }).passed = null;
      const model = build(sampleSnapshot(input));
      expect(model.items[0].votes[0]).toMatchObject({ outcome: null, outcomeText: null });
      expect(model.agreements).toEqual([]);
    });
  });

  describe('observaciones, actuaciones y cierre', () => {
    it('comentarios generales como observaciones y próximos pasos solo si existen', () => {
      const model = build();
      expect(model.observations).toMatchObject({ title: 'OBSERVACIONES', text: 'La junta se desarrolló con normalidad.' });
      expect(model.nextSteps).toMatchObject({ title: 'ACTUACIONES DERIVADAS DE LOS ACUERDOS', text: 'Solicitar 3 presupuestos.\nRevisar la iluminación.' });
    });

    it('sin comentarios generales ni próximos pasos, esas secciones quedan vacías (no se muestran)', () => {
      const input = snapshotInput();
      input.meeting.actaGeneralComments = null;
      input.meeting.actaNextSteps = '   ';
      const model = build(sampleSnapshot(input), { ...texts, observations: null });
      expect(model.observations.text).toBe('');
      expect(model.nextSteps.text).toBe('');
    });

    it('cierre con la hora real de fin; sin ella se omite y se anota', () => {
      expect(build().closing.paragraph).toBe('Y no habiendo más asuntos que tratar, se levanta la sesión a las 21:05 horas.');
      const input = snapshotInput();
      input.meeting.actualEndAt = null;
      const model = build(sampleSnapshot(input));
      expect(model.closing.paragraph).toBeNull();
      expect(model.missing).toContain('actualEndAt');
    });

    it('si la sesión termina otro día, el cierre lo dice', () => {
      const input = snapshotInput();
      input.meeting.actualEndAt = new Date('2026-10-15T00:30:00Z'); // 02:30 del 15 en Madrid
      expect(build(sampleSnapshot(input)).closing.paragraph).toBe('Y no habiendo más asuntos que tratar, se levanta la sesión a las 02:30 horas del día 15 de octubre de 2026.');
    });

    it('reserva las firmas del presidente y del secretario sin inventar personas', () => {
      const { signatures } = build();
      expect(signatures.blocks).toEqual([
        { role: 'presidente', lines: ['Vº Bº', 'EL/LA PRESIDENTE/A'] },
        { role: 'secretario', lines: ['EL/LA SECRETARIO/A-ADMINISTRADOR/A'] },
      ]);
    });
  });

  describe('trazabilidad y determinismo', () => {
    it('cada sección indica de qué datos sale', () => {
      const model = build();
      expect(model.items[0].source).toMatchObject({ agendaItemId: 'a1', voteSessionIds: ['s1'] });
      expect(model.items[0].source.fields).toEqual(expect.arrayContaining(['agenda.comments', 'voteSession.resultSummary']));
      expect(model.items[0].votes[0].source.voteSessionIds).toEqual(['s1']);
      expect(model.items[1].narrative.source).toEqual({ agendaItemId: 'a2', fields: ['agenda.comments'] });
      expect(model.attendance.source.fields).toContain('attendance.participationQuota');
    });

    it('es una función pura: mismo snapshot y textos, mismo documento y mismo hash, a cualquier hora', () => {
      const first = actaContentHash(build());
      jest.useFakeTimers().setSystemTime(new Date('2031-01-01T00:00:00Z'));
      try {
        expect(actaContentHash(build())).toBe(first);
      } finally {
        jest.useRealTimers();
      }
    });

    it('el hash SHA-256 es estable (64 hex) e independiente del orden de las claves', () => {
      const model = build();
      const hash = actaContentHash(model);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      const shuffled = JSON.parse(JSON.stringify(model));
      const reordered = Object.fromEntries(Object.entries(shuffled).reverse());
      expect(canonicalJson(reordered)).toBe(canonicalJson(model));
      expect(actaContentHash(reordered)).toBe(hash);
    });

    it('cambiar un dato factual o un texto cambia el hash', () => {
      const base = actaContentHash(build());
      const input = snapshotInput();
      (input.voteSessions[0].resultSummary as { passed: boolean }).passed = false;
      expect(actaContentHash(build(sampleSnapshot(input)))).not.toBe(base);
      expect(actaContentHash(build(sampleSnapshot(), { ...texts, observations: { text: 'Otro.', origin: 'notes' } }))).not.toBe(base);
    });

    it('identifica a quien asistió con nombre y DNI, pero no incluye emails', () => {
      expect(JSON.stringify(build())).not.toMatch(/@/);
    });
  });
});
