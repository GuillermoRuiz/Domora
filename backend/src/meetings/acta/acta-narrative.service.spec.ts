import { ActaNarrativeService, formalizeNotes, isFaithfulDraft, notesAsText } from './acta-narrative.service';
import { MEETING_MINUTES_PROMPT, MEETING_MINUTES_SCHEMA } from '../../ai/meeting-minutes.contract';
import { AiOutputService } from '../../ai/ai-output.service';
import { draftMeetingMinutes } from '../../ai/use-cases';

const sections = [
  { id: 'a1', title: 'Presupuesto 2027', notes: '  Se presenta el presupuesto.  \n\n Intervino 1B.  ' },
  { id: 'a2', title: 'Ruegos', notes: '   ' },
  { id: 'observations', title: 'Observaciones', notes: 'Todo con normalidad.' },
];

function service(options: { enabled: boolean; sync?: jest.Mock }) {
  const ai = { run: options.sync ?? jest.fn() };
  const config = { enabled: options.enabled };
  return { service: new ActaNarrativeService(ai as never, config as never), ai };
}

describe('ActaNarrativeService — redacción sin inventar hechos', () => {
  it('con la IA desactivada usa las notas originales con estructura determinista y no llama al modelo', async () => {
    const { service: narrator, ai } = service({ enabled: false });
    const result = await narrator.draft(sections);
    expect(ai.run).not.toHaveBeenCalled();
    expect(result.mode).toBe('fallback');
    expect(result.sections).toEqual({
      a1: { text: 'Se presenta el presupuesto.\nIntervino 1B.', mode: 'notes' },
      observations: { text: 'Todo con normalidad.', mode: 'notes' },
    });
  });

  it('sin notas no hay nada que redactar ni se llama al modelo', async () => {
    const { service: narrator, ai } = service({ enabled: true });
    const result = await narrator.draft([{ id: 'a1', title: 'Punto', notes: '  ' }]);
    expect(ai.run).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: 'fallback', sections: {} });
  });

  it('solo envía al modelo título y notas: nunca asistentes, cuotas, votos, fechas ni resultados', async () => {
    const sync = jest.fn().mockResolvedValue({ value: { sections: [{ id: 'a1', text: 'Se presenta el presupuesto. Interviene 1B.' }] }, model: 'm', usage: null });
    const { service: narrator } = service({ enabled: true, sync });
    await narrator.draft(sections);
    expect(sync).toHaveBeenCalledWith(draftMeetingMinutes, {
      sections: [
        { id: 'a1', title: 'Presupuesto 2027', notes: 'Se presenta el presupuesto.\nIntervino 1B.' },
        { id: 'observations', title: 'Observaciones', notes: 'Todo con normalidad.' },
      ],
    });
  });

  it('usa la redacción del modelo cuando es fiel, y las notas originales para las secciones que no devuelve', async () => {
    const sync = jest.fn().mockResolvedValue({ value: { sections: [{ id: 'a1', text: 'Se presenta el presupuesto y la propiedad 1B interviene.' }] }, model: 'gpt-x', usage: null });
    const { service: narrator } = service({ enabled: true, sync });
    const result = await narrator.draft(sections);
    expect(result.mode).toBe('llm');
    expect(result.model).toBe('gpt-x');
    expect(result.sections.a1).toEqual({ text: 'Se presenta el presupuesto y la propiedad 1B interviene.', mode: 'llm' });
    expect(result.sections.observations).toEqual({ text: 'Todo con normalidad.', mode: 'notes' });
  });

  it('descarta una redacción que inventa cifras y conserva las notas de esa sección', async () => {
    const sync = jest.fn().mockResolvedValue({ value: { sections: [{ id: 'a1', text: 'Se aprueba por 12 votos un presupuesto de 40.000 euros.' }] }, model: 'gpt-x', usage: null });
    const { service: narrator } = service({ enabled: true, sync });
    const result = await narrator.draft([sections[0]]);
    expect(result.mode).toBe('fallback');
    expect(result.sections.a1).toEqual({ text: 'Se presenta el presupuesto.\nIntervino 1B.', mode: 'notes' });
    expect(result.reason).toContain('1 sección');
  });

  it('si el modelo falla, el acta se genera igual con las notas', async () => {
    const sync = jest.fn().mockRejectedValue(new Error('OPENAI_HTTP_500'));
    const { service: narrator } = service({ enabled: true, sync });
    const result = await narrator.draft(sections);
    expect(result.mode).toBe('fallback');
    expect(result.reason).toBe('Redacción automática no disponible.');
    expect(result.reason).not.toContain('OPENAI');
    expect(result.sections.a1.mode).toBe('notes');
  });

  it('funciona sin infraestructura de IA inyectada', async () => {
    const result = await new ActaNarrativeService().draft(sections);
    expect(result.mode).toBe('fallback');
    expect(result.sections.a1.mode).toBe('notes');
  });

  it('isFaithfulDraft rechaza vacíos, excesos de longitud y cifras nuevas, y acepta las del título y las notas', () => {
    const input = { id: 'a', title: 'Obras 2027', notes: 'Se pide presupuesto a 3 empresas.' };
    expect(isFaithfulDraft(input, 'Se solicita presupuesto a 3 empresas para las obras 2027.')).toBe(true);
    expect(isFaithfulDraft(input, '')).toBe(false);
    expect(isFaithfulDraft(input, 'Se solicitan 5 presupuestos.')).toBe(false);
    expect(isFaithfulDraft(input, 'x'.repeat(2000))).toBe(false);
  });

  it('notesAsText recorta y elimina líneas vacías sin tocar el contenido', () => {
    expect(notesAsText('  Uno \n\n  Dos  ')).toBe('Uno\nDos');
  });

  it('el modo sin IA solo pone mayúscula inicial y punto final: no cambia, añade ni quita palabras', () => {
    expect(formalizeNotes('se presenta el presupuesto. interviene 1B\n\n  ¿se aprueba?  ')).toBe('Se presenta el presupuesto. interviene 1B.\n¿Se aprueba?');
    expect(formalizeNotes('«Texto entre comillas»')).toBe('«Texto entre comillas»');
    expect(formalizeNotes('1. Primero')).toBe('1. Primero.');
    expect(formalizeNotes('')).toBe('');
  });

  it('el desarrollo sin IA parte de las notas con esa ortografía mínima', async () => {
    const { service: narrator } = service({ enabled: false });
    const result = await narrator.draft([{ id: 'a1', title: 'Ruegos', notes: 'se pide arreglar la luz del portal' }]);
    expect(result.sections.a1).toEqual({ text: 'Se pide arreglar la luz del portal.', mode: 'notes' });
  });
});

describe('contrato del redactor (prompt y esquema)', () => {
  it('el prompt es restrictivo: solo hechos del input, sin inventar ni calcular nada', () => {
    expect(MEETING_MINUTES_PROMPT).toContain('You may ONLY state facts explicitly provided in the input JSON.');
    for (const forbidden of ['people', 'vote results', 'legal conclusions', 'dates', 'times', 'amounts', 'responsibilities', 'deadlines']) {
      expect(MEETING_MINUTES_PROMPT).toMatch(new RegExp(`- ${forbidden}[;.]`));
    }
    expect(MEETING_MINUTES_PROMPT).toContain('Do not classify legal majorities.');
    expect(MEETING_MINUTES_PROMPT).toContain('Do not calculate voting results.');
    expect(MEETING_MINUTES_PROMPT).toContain('If there are no notes, return no narrative text.');
  });

  it('se resuelve por el mismo AiOutputService que el resto de usos de IA y valida la salida', () => {
    const outputs = new AiOutputService();
    expect(outputs.prompt('meeting-minutes')).toBe(MEETING_MINUTES_PROMPT);
    expect(outputs.schema('meeting-minutes')).toEqual(MEETING_MINUTES_SCHEMA);
    expect(() => outputs.validate('meeting-minutes', { sections: [{ id: 'a1', text: 'Texto.' }] })).not.toThrow();
    expect(() => outputs.validate('meeting-minutes', { sections: [{ id: 'a1' }] })).toThrow();
    expect(() => outputs.validate('meeting-minutes', { sections: [], extra: 1 })).toThrow();
  });
});
