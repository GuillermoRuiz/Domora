// `jszip` es la dependencia con la que `docx` empaqueta el .docx: sirve para leer el XML generado.
import JSZip from 'jszip';
import { ActaDocxService, type ActaData } from './acta-docx.service';
import type { Meeting } from '../prisma/client';
import { buildActaDocument } from './acta/acta-document.builder';
import { sampleSnapshot } from '../testing/acta-fixtures';

async function documentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml')!.async('string');
}

const meeting = (agenda: unknown) =>
  ({
    id: 'm1',
    title: 'Junta ordinaria',
    agenda,
    scheduledAt1: new Date('2026-10-22T18:00:00Z'),
    celebratedAt: new Date('2026-10-22T19:00:00Z'),
  }) as unknown as Meeting;

const data = {
  quorum: {
    convocatoria: 'primera',
    quorumRequired: true,
    quorumMet: true,
    owners: { present: 2, total: 3, percent: 66.7 },
    quota: { present: 60, total: 100, percent: 60 },
    missingParticipationQuotaCount: 0,
    attendingProperties: [],
  },
  attendance: [],
  delegations: [],
  voteSessions: [],
  presidenteName: 'Ana',
  secretarioName: 'Luis',
} as unknown as ActaData;

describe('ActaDocxService — comentarios generales y próximos pasos', () => {
  const service = new ActaDocxService();
  const withNotes = (notes: Record<string, unknown>) => ({ ...meeting([]), ...notes }) as unknown as Meeting;

  it('incluye los comentarios generales y los próximos pasos que anotó la gestora', async () => {
    const xml = await documentXml(
      await service.generate(
        withNotes({ actaGeneralComments: 'Sin incidencias.', actaNextSteps: 'Pedir 3 presupuestos.\nRevisar la iluminación.' }),
        data,
      ),
    );
    expect(xml).toContain('Comentarios generales');
    expect(xml).toContain('Sin incidencias.');
    expect(xml).toContain('Comentarios y próximos pasos');
    expect(xml).toContain('Pedir 3 presupuestos.');
    expect(xml).toContain('Revisar la iluminación.');
  });

  it('no añade secciones vacías cuando no hay texto', async () => {
    const xml = await documentXml(await service.generate(withNotes({ actaGeneralComments: '  ', actaNextSteps: null }), data));
    expect(xml).not.toContain('Comentarios generales');
    expect(xml).not.toContain('próximos pasos');
  });
});

describe('ActaDocxService — orden del día con comentarios', () => {
  const service = new ActaDocxService();

  it('lista cada punto con los comentarios que anotó el administrador, línea a línea', async () => {
    const xml = await documentXml(
      await service.generate(
        meeting([
          { id: 'a1', title: 'Aprobación del presupuesto', comments: 'Se aprueba con una reserva.\nVoto en contra de 2B.' },
          { id: 'a2', title: 'Ruegos y preguntas' },
        ]),
        data,
      ),
    );
    expect(xml).toContain('Orden del día');
    expect(xml).toContain('1. Aprobación del presupuesto');
    expect(xml).toContain('Se aprueba con una reserva.');
    expect(xml).toContain('Voto en contra de 2B.');
    expect(xml).toContain('2. Ruegos y preguntas');
  });

  it('sin puntos lo indica, y un punto sin comentarios no añade líneas vacías de comentario', async () => {
    const empty = await documentXml(await service.generate(meeting([]), data));
    expect(empty).toContain('Sin puntos en el orden del día.');
    const plain = await documentXml(await service.generate(meeting([{ id: 'a1', title: 'Informe', comments: '   ' }]), data));
    expect(plain).toContain('1. Informe');
  });
});

describe('ActaDocxService.generateFromModel — el .docx consume el modelo canónico', () => {
  const service = new ActaDocxService();
  const model = buildActaDocument(sampleSnapshot(), {
    items: { a1: { text: 'Se presenta el presupuesto anual.', origin: 'notes' } },
    observations: { text: 'La junta se desarrolló con normalidad.', origin: 'notes' },
  });

  it('contiene el acta formal completa tal y como la describe el modelo', async () => {
    const xml = await documentXml(await service.generateFromModel(model));
    for (const expected of [
      'ACTA DE LA JUNTA GENERAL ORDINARIA',
      'COMUNIDAD SOL 12',
      'siendo las 19:10 horas del día 14 de octubre de 2026',
      'ORDEN DEL DÍA',
      'Aprobación del presupuesto 2027',
      'Representada',
      'Se presenta el presupuesto anual.',
      'A favor: 2',
      'La propuesta resulta aprobada.',
      'ACUERDO: Se aprueba la propuesta sometida a votación.',
      'OBSERVACIONES',
      'ACTUACIONES DERIVADAS DE LOS ACUERDOS',
      'se levanta la sesión a las 21:05 horas',
      'EL/LA PRESIDENTE/A',
      'EL/LA SECRETARIO/A-ADMINISTRADOR/A',
    ]) {
      expect(xml).toContain(expected);
    }
  });

  it('la tabla de asistencia nunca lleva el DNI (igual que el PDF), tampoco el de versiones que lo guardaron', async () => {
    const withDni = JSON.parse(JSON.stringify(model));
    withDni.labels.attendanceColumns = ['PROPIEDAD', 'ASISTENTE', 'DNI', 'COEFICIENTE', 'ASISTENCIA'];
    withDni.attendance.rows = withDni.attendance.rows.map((row: Record<string, unknown>) => ({ ...row, attendeeDni: '12345678Z' }));
    const xml = await documentXml(await service.generateFromModel(withDni));
    expect(xml).toContain('ASISTENTE');
    expect(xml).not.toContain('DNI');
    expect(xml).not.toContain('12345678Z');
  });

  it('no reconstruye lógica propia: lo que se edite en el modelo es lo que sale en el documento', async () => {
    const edited = JSON.parse(JSON.stringify(model));
    edited.items[0].narrative.text = 'Texto editado por la gestora.';
    edited.items[0].votes[0].lines.outcome = null;
    const xml = await documentXml(await service.generateFromModel(edited));
    expect(xml).toContain('Texto editado por la gestora.');
    expect(xml).not.toContain('La propuesta resulta aprobada.');
  });
});
