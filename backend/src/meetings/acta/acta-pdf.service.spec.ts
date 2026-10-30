import { ActaPdfService } from './acta-pdf.service';
import { printableAttendance } from './acta-document.model';
import { buildActaDocument, type ActaTexts } from './acta-document.builder';
import { buildActaSnapshot } from './acta-snapshot.service';
import { sampleSnapshot, snapshotInput } from '../../testing/acta-fixtures';
import type { ActaSnapshotInput } from './acta-snapshot.service';

const pdf = new ActaPdfService();

const texts: ActaTexts = {
  items: {
    a1: { text: 'Se presenta el presupuesto anual de la comunidad.', origin: 'generated' },
    a2: { text: 'Se pide revisar la iluminación del portal.', origin: 'notes' },
  },
  observations: { text: 'La junta se desarrolló con normalidad.', origin: 'notes' },
};

/** Texto de cada página: pdfkit escribe los literales en hexadecimal dentro de los operadores TJ. */
function pages(buffer: Buffer): string[][] {
  const raw = buffer.toString('latin1');
  return raw
    .split('endstream')
    // Solo los flujos de contenido de página (llevan operadores de texto); se ignoran fuentes y metadatos binarios.
    .filter((stream) => /\bBT\b/.test(stream))
    .map((stream) => (stream.match(/<([0-9A-Fa-f]+)>/g) ?? []).map((chunk) => Buffer.from(chunk.slice(1, -1), 'hex').toString('latin1')))
    .filter((chunks) => chunks.length > 0);
}
const flat = (buffer: Buffer) => pages(buffer).flat().join('');
/** pdfkit justifica con espaciado entre palabras: se compara sin espacios para no depender de ello. */
const squash = (text: string) => text.replace(/\s+/g, '');
const includes = (text: string, expected: string) => squash(text).includes(squash(expected));
const render = (model = buildActaDocument(sampleSnapshot(), texts)) => pdf.render(model, { compress: false, footerNote: 'SHA-256 1a2b3c4d' });

/** Junta grande: 70 propiedades presentes y muchos puntos largos, para forzar varias páginas. */
function bigInput(): ActaSnapshotInput {
  const input = snapshotInput();
  input.properties = Array.from({ length: 70 }, (_, index) => ({
    id: `p${index}`,
    ref: `${Math.floor(index / 7) + 1}-${String.fromCharCode(65 + (index % 7))}`,
    floor: null,
    door: null,
    participationQuota: '1.40',
  }));
  input.attendedPropertyIds = new Set(input.properties.slice(0, 60).map((property) => property.id));
  input.delegatedPropertyIds = new Set(['p3', 'p9']);
  const agenda = Array.from({ length: 14 }, (_, index) => ({
    id: `g${index}`,
    title: `Punto número ${index + 1} del orden del día con un título razonablemente largo`,
    comments: `Notas del punto ${index + 1}.`,
    hasVote: index % 2 === 0,
    ...(index % 2 === 0 ? { voteTemplate: { questions: [{ title: `¿Aprueba el punto ${index + 1}?`, type: 'single_choice', options: ['A favor', 'En contra', 'Abstención'] }] } } : {}),
  }));
  input.meeting.agenda = agenda;
  input.voteSessions = agenda
    .filter((item) => item.hasVote)
    .map((item, index) => ({
      id: `s${index}`,
      agendaItemId: item.id,
      questionIndex: 0,
      majorityType: 'mayoriaSimple' as const,
      closedAt: new Date('2026-10-14T18:00:00Z'),
      responseCount: 60,
      resultSummary: {
        passed: index % 3 !== 0,
        denominatorBasis: 'presentes',
        ownersFavorablePct: 70,
        quotaFavorablePct: 71.5,
        optionTally: [
          { optionIndex: 0, propertyCount: 40 },
          { optionIndex: 1, propertyCount: 15 },
          { optionIndex: 2, propertyCount: 5 },
        ],
      },
    }));
  return input;
}
const longText = 'Se expone el asunto con detalle y se recogen las manifestaciones realizadas por los asistentes. '.repeat(14).trim();
const bigTexts = (): ActaTexts => ({
  items: Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`g${index}`, { text: longText, origin: 'notes' as const }])),
  observations: { text: longText, origin: 'notes' },
});

describe('ActaPdfService — PDF del acta desde el modelo canónico', () => {
  it('produce un PDF A4 válido', async () => {
    const buffer = await pdf.render(buildActaDocument(sampleSnapshot(), texts));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);
    const raw = (await render()).toString('latin1');
    expect(raw).toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it('parece un acta: encabezado formal, constitución, orden del día, asistencia, desarrollo, cierre y firmas', async () => {
    const text = flat(await render());
    for (const expected of [
      'ACTA DE LA JUNTA GENERAL ORDINARIA',
      'DE LA COMUNIDAD DE PROPIETARIOS',
      'COMUNIDAD SOL 12',
      'siendo las 19:10 horas del día 14 de octubre de 2026',
      'en primera convocatoria',
      'ORDEN DEL DÍA',
      '1º  Aprobación del presupuesto 2027',
      'ASISTENCIA',
      'PROPIEDAD',
      'COEFICIENTE',
      'ASISTENCIA',
      '2,50 %',
      'Representada',
      'DESARROLLO',
      'Se presenta el presupuesto anual de la comunidad.',
      'A favor: 2',
      'En contra: 1',
      'Abstención: 0',
      'La propuesta resulta aprobada.',
      'ACUERDO: Se aprueba la propuesta sometida a votación.',
      'OBSERVACIONES',
      'ACTUACIONES DERIVADAS DE LOS ACUERDOS',
      'Y no habiendo más asuntos que tratar, se levanta la sesión a las 21:05 horas.',
      'EL/LA PRESIDENTE/A',
      'EL/LA SECRETARIO/A-ADMINISTRADOR/A',
    ]) {
      expect(includes(text, expected)).toBe(true);
    }
  });

  it('no usa componentes de dashboard: sin colores de relleno, solo texto negro sobre fondo blanco', async () => {
    const raw = (await render()).toString('latin1');
    // Ningún operador de relleno de color distinto del negro/gris de texto y de líneas.
    expect(raw).not.toMatch(/\d\.\d+ \d\.\d+ \d\.\d+ rg/);
    expect(raw).not.toMatch(/ re\s+f/);
  });

  it('no muestra emails ni firmas «Fdo.»', async () => {
    const text = flat(await render());
    expect(text).not.toMatch(/@|Fdo\./);
  });

  it('puntos no tratados, sin votación y sin comentarios salen con su frase real, sin inventar contenido', async () => {
    const text = flat(await render());
    expect(includes(text, 'El punto quedó tratado sin contenido adicional registrado.')).toBe(true);
    expect(includes(text, 'Este punto no consta como tratado en la reunión.')).toBe(true);
  });

  it('la tabla de asistencia lleva el nombre completo de quien asistió y de quien representa, pero nunca el DNI', async () => {
    const text = flat(await render());
    expect(includes(text, 'ASISTENTE')).toBe(true);
    expect(includes(text, 'DNI')).toBe(false);
    expect(includes(text, '12345678Z')).toBe(false);
    expect(includes(text, '87654321X')).toBe(false);
    expect(includes(text, 'Mónica Prieto Ruiz')).toBe(true);
    expect(includes(text, 'Pedro Sanz Vega')).toBe(true);
    expect(includes(text, 'en representación de')).toBe(true);
  });

  it('la tabla de asistencia no tiene columna de DNI y conserva el resto de rótulos', async () => {
    const text = flat(await render());
    for (const label of ['PROPIEDAD', 'ASISTENTE', 'COEFICIENTE', 'ASISTENCIA']) expect(includes(text, label)).toBe(true);
    expect(text).not.toContain('DNI');
  });

  it('también quita el DNI de las versiones que lo guardaron en el documento', () => {
    const model = buildActaDocument(sampleSnapshot(), texts);
    const table = printableAttendance(model.labels.attendanceColumns, model.attendance.rows);
    expect(table.labels).toEqual(['PROPIEDAD', 'ASISTENTE', 'COEFICIENTE', 'ASISTENCIA']);
    expect(table.rows.every((cells) => cells.length === 4)).toBe(true);
    expect(table.rows.flat().join(' ')).not.toMatch(/12345678Z|87654321X/);
  });

  it('con passed null no dice aprobado ni rechazado', async () => {
    const input = snapshotInput();
    (input.voteSessions[0].resultSummary as { passed: boolean | null }).passed = null;
    const text = flat(await render(buildActaDocument(buildActaSnapshot(input), texts)));
    expect(text).not.toContain('resulta aprobada');
    expect(text).not.toContain('resulta rechazada');
    expect(text).not.toContain('ACUERDO:');
  });

  it('sin observaciones ni actuaciones no pinta secciones vacías', async () => {
    const input = snapshotInput();
    input.meeting.actaGeneralComments = null;
    input.meeting.actaNextSteps = null;
    const text = flat(await render(buildActaDocument(buildActaSnapshot(input), { items: {}, observations: null })));
    expect(text).not.toContain('OBSERVACIONES');
    expect(text).not.toContain('ACTUACIONES DERIVADAS');
  });

  it('sin hora de fin no hay párrafo de cierre', async () => {
    const input = snapshotInput();
    input.meeting.actualEndAt = null;
    const text = flat(await render(buildActaDocument(buildActaSnapshot(input), texts)));
    expect(text).not.toContain('se levanta la sesión');
  });

  it('numera las páginas y pone en el pie solo la huella, sin versión ni estado', async () => {
    const perPage = pages(await render());
    const total = perPage.length;
    perPage.forEach((chunks, index) => {
      expect(chunks.join('')).toContain(`Página ${index + 1} de ${total}`);
      expect(chunks.join('')).toContain('SHA-256 1a2b3c4d');
      expect(chunks.join('')).not.toMatch(/Versi[oó]n 1|Borrador/);
    });
  });

  describe('acta multipágina', () => {
    const model = buildActaDocument(buildActaSnapshot(bigInput()), bigTexts());

    it('reparte el contenido en varias páginas con numeración, encabezado discreto y cabecera de tabla repetida', async () => {
      const buffer = await pdf.render(model, { compress: false, footerNote: 'SHA-256 2b3c4d5e' });
      const perPage = pages(buffer);
      expect(perPage.length).toBeGreaterThanOrEqual(4);
      const total = perPage.length;
      perPage.forEach((chunks, index) => expect(chunks.join('')).toContain(`Página ${index + 1} de ${total}`));
      // Encabezado discreto a partir de la 2ª página, no en la primera.
      expect(perPage[0].join('')).not.toContain('Comunidad Sol 12');
      expect(perPage[1].join('')).toContain('Comunidad Sol 12');
      expect(perPage[1].join('')).toContain('ACTA DE LA JUNTA GENERAL ORDINARIA');
      // La tabla de asistencia ocupa más de una página y repite su cabecera.
      const withHeader = perPage.filter((chunks) => chunks.join('').includes('PROPIEDAD'));
      expect(withHeader.length).toBeGreaterThanOrEqual(2);
    });

    it('no parte una fila de asistencia: cada fila (propiedad, coeficiente y estado) cae entera en una página', async () => {
      const perPage = pages(await pdf.render(model, { compress: false }));
      const rowsPerPage = perPage.map((chunks) => chunks.filter((chunk) => /^\d+-[A-G]$/.test(chunk)).length);
      const quotasPerPage = perPage.map((chunks) => chunks.filter((chunk) => chunk === '1,40 %').length);
      const statesPerPage = perPage.map((chunks) => chunks.filter((chunk) => chunk === 'Presente' || chunk === 'Representada').length);
      expect(rowsPerPage).toEqual(quotasPerPage);
      expect(rowsPerPage).toEqual(statesPerPage);
      expect(rowsPerPage.reduce((a, b) => a + b, 0)).toBe(60);
    });

    it('un encabezado de punto nunca se queda solo al final de una página', async () => {
      const perPage = pages(await pdf.render(model, { compress: false }));
      for (const chunks of perPage) {
        const body = chunks.filter((chunk) => !chunk.startsWith('Página ') && !chunk.includes('ACTA DE LA JUNTA GENERAL') && !chunk.startsWith('Versión'));
        const last = body[body.length - 1] ?? '';
        expect(last).not.toMatch(/^\d+º\s{2}PUNTO NÚMERO/);
        expect(last).not.toBe('DESARROLLO');
        expect(last).not.toBe('ORDEN DEL DÍA');
        expect(last).not.toBe('ASISTENCIA');
      }
    });

    it('las firmas (presidente y secretario) caen siempre juntas en la misma página', async () => {
      const perPage = pages(await pdf.render(model, { compress: false }));
      const president = perPage.findIndex((chunks) => chunks.join('').includes('EL/LA PRESIDENTE/A'));
      const secretary = perPage.findIndex((chunks) => chunks.join('').includes('EL/LA SECRETARIO/A-ADMINISTRADOR/A'));
      expect(president).toBeGreaterThanOrEqual(0);
      expect(president).toBe(secretary);
    });

    it('contiene todos los puntos y todas las votaciones', async () => {
      const text = flat(await pdf.render(model, { compress: false }));
      for (let n = 1; n <= 14; n++) expect(includes(text, `PUNTO NÚMERO ${n} DEL ORDEN DEL DÍA`)).toBe(true);
      expect(text.match(/Mayoría aplicada: Mayoría simple\./g)?.length).toBe(7);
    });
  });

  it('descarta con elegancia caracteres que las fuentes estándar no soportan', async () => {
    const model = buildActaDocument(sampleSnapshot(), { ...texts, observations: { text: 'Todo bien 😀 y «correcto» — fin ≥ 3', origin: 'notes' } });
    const text = flat(await pdf.render(model, { compress: false }));
    expect(text).toContain('Todo bien');
    expect(text).toContain('«correcto»');
    expect(text).not.toMatch(/😀|≥|�|\?\?/);
    expect(text).toContain(String.fromCharCode(0x97)); // el guion largo se conserva (WinAnsi 0x97)
  });
});
