import { TestBed } from '@angular/core/testing';
import type { Meeting } from '../../../../core/models';
import { JuntaDraftStore, addMinutes } from './junta-draft.store';

function setup(): JuntaDraftStore {
  TestBed.configureTestingModule({ providers: [JuntaDraftStore] });
  const store = TestBed.inject(JuntaDraftStore);
  store.reset();
  return store;
}

function fillValidDetails(store: JuntaDraftStore): void {
  store.title.set('Junta ordinaria de enero');
  store.scheduledAt1.set('2027-01-15T18:00');
  store.scheduledAt2.set('2027-01-15T18:30');
}

describe('JuntaDraftStore', () => {
  describe('ordinary agenda defaults', () => {
    it('prepares three points (accounts and budget with description and vote) only once across navigation', () => {
      const store = setup();
      store.prepareAgenda();
      expect(store.agenda().map(i => i.title)).toEqual([
        'Aprobación de las cuentas del ejercicio anterior',
        'Aprobación del presupuesto del ejercicio siguiente',
        'Renovación o nombramiento de los cargos de la comunidad',
      ]);
      const [accounts, budget, officers] = store.agenda();
      for (const [item, question] of [[accounts, '¿Aprueba las cuentas del ejercicio anterior?'], [budget, '¿Aprueba el presupuesto del ejercicio siguiente?']] as const) {
        expect(item.description).toBeTruthy();
        expect(item.hasVote).toBe(true);
        expect(item.voteTemplate).toEqual({
          questions: [{ title: question, type: 'single_choice', options: ['A favor', 'En contra'], majorityType: 'mayoriaSimple' }],
        });
      }
      expect(officers).toMatchObject({ description: '', hasVote: false });
      expect(officers.voteTemplate).toBeUndefined();
      expect(accounts.voteTemplate).not.toBe(budget.voteTemplate);
      store.agenda.update(items => items.slice(0, 2));
      store.prepareAgenda();
      expect(store.agenda()).toHaveLength(2);
    });

    it('does not seed a new extraordinary meeting', () => {
      const store = setup();
      store.setType('extraordinaria');
      store.prepareAgenda();
      expect(store.agenda().filter(i => i.title)).toEqual([]);
    });

    it('preserves custom and edited points across type changes and save/reopen', () => {
      const store = setup();
      fillValidDetails(store);
      store.agenda.set([{ id: 'custom', title: 'Ascensor', comments: 'Conservar' }]);
      store.setType('ordinaria');
      store.agenda.update(items => items.map((i, index) => index === 0 ? { ...i, title: 'Cuentas editadas', description: 'Detalle' } : i));
      const before = structuredClone(store.agenda());
      store.setType('extraordinaria');
      expect(store.agenda()).toEqual(before);
      store.setType('ordinaria');
      store.setType('ordinaria');
      expect(store.agenda()).toEqual(before);
      const saved = JSON.parse(JSON.stringify(store.toPayload()));
      store.loadFromMeeting(saved as Meeting);
      store.prepareAgenda();
      store.setType('ordinaria');
      expect(store.agenda()).toEqual(before);
    });

    it('does not modify historical agendas on load or navigation', () => {
      const store = setup();
      fillValidDetails(store);
      const saved = { ...store.toPayload(), agenda: [{ id: 'old', title: 'Histórico' }] } as Meeting;
      store.loadFromMeeting(saved);
      store.prepareAgenda();
      expect(store.agenda()).toEqual(saved.agenda);
      expect(store.isDirty()).toBe(false);
    });

    it('recognizes an existing manual default title without replacing its data', () => {
      const store = setup();
      const manual = { id: 'manual', title: 'Aprobación de las cuentas del ejercicio anterior', comments: 'Notas' };
      store.agenda.set([manual]);
      store.setType('ordinaria');
      expect(store.agenda()).toHaveLength(3);
      expect(store.agenda().find(i => i.id === 'manual')).toMatchObject(manual);
      expect(store.agenda().find(i => i.id === 'manual')?.systemGenerated).toBeUndefined();
    });
  });
  describe('validation (same rules and messages as the single-form modal)', () => {
    it('requires a title first', () => {
      const store = setup();
      expect(store.validateDetails()).toEqual({ step: 1, field: 'title', message: 'El título es obligatorio.' });
      store.title.set('   ');
      expect(store.validateDetails()?.field).toBe('title');
    });

    it('requires both convocations, the second one after the first', () => {
      const store = setup();
      store.title.set('Junta');
      expect(store.validateDetails()).toEqual({
        step: 1,
        field: 'dates',
        message: 'Debes indicar fecha y hora de 1ª y 2ª convocatoria.',
      });
      store.scheduledAt1.set('2027-01-15T18:00');
      store.scheduledAt2.set('2027-01-15T17:30');
      expect(store.validateDetails()?.message).toBe('La 2ª convocatoria debe ser posterior a la 1ª convocatoria.');
      store.scheduledAt2.set('2027-01-15T18:30');
      expect(store.validateDetails()).toBeNull();
    });

    it('requires every agenda point to have a title', () => {
      const store = setup();
      expect(store.validateAgenda()).toEqual({
        step: 2,
        field: 'agenda',
        message: 'Todos los puntos deben tener título.',
      });
      store.agenda.set([]);
      expect(store.validateAgenda()?.message).toBe('Agrega al menos un punto al orden del día.');
    });

    it('validates vote questions and their options', () => {
      const store = setup();
      store.agenda.set([
        {
          id: 'a1',
          title: 'Cuentas',
          hasVote: true,
          voteTemplate: { questions: [{ title: '', type: 'single_choice', options: ['Sí', 'No'] }] },
        },
      ]);
      expect(store.validateAgenda()?.message).toBe('Hay preguntas sin título en "Cuentas".');
      store.agenda.set([
        {
          id: 'a1',
          title: 'Cuentas',
          hasVote: true,
          voteTemplate: { questions: [{ title: '¿Aprueba?', type: 'single_choice', options: ['Sí'] }] },
        },
      ]);
      expect(store.validateAgenda()?.message).toBe('Una pregunta de opciones necesita al menos 2 opciones en "Cuentas".');
      store.agenda.set([
        {
          id: 'a1',
          title: 'Cuentas',
          hasVote: true,
          voteTemplate: { questions: [{ title: '¿Aprueba?', type: 'text' }] },
        },
      ]);
      expect(store.validateAgenda()).toBeNull();
    });

    it('requires the majority type of every voted question (free text has none)', () => {
      const store = setup();
      const withQuestion = (majorityType?: 'mayoriaSimple') => [
        {
          id: 'a1',
          title: 'Cuentas',
          hasVote: true,
          voteTemplate: { questions: [{ title: '¿Aprueba?', type: 'single_choice' as const, options: ['Sí', 'No'], majorityType }] },
        },
      ];
      store.agenda.set(withQuestion(undefined));
      expect(store.validateAgenda()?.message).toBe('Elige el tipo de mayoría de cada pregunta de "Cuentas".');
      store.agenda.set(withQuestion('mayoriaSimple'));
      expect(store.validateAgenda()).toBeNull();
    });

    it('reports the first error across a range of steps', () => {
      const store = setup();
      expect(store.firstError(1, 2)?.step).toBe(1);
      fillValidDetails(store);
      expect(store.firstError(1, 2)?.step).toBe(2);
      expect(store.firstError(1, 1)).toBeNull();
      store.agenda.set([{ id: 'a1', title: 'Cuentas' }]);
      expect(store.firstError(1, 2)).toBeNull();
    });
  });

  describe('toPayload', () => {
    it('keeps the backend contract: ISO dates, joined location, trimmed names, attendee emails', () => {
      const store = setup();
      fillValidDetails(store);
      store.type.set('extraordinaria');
      store.convokedBy.set('cuotas25');
      store.street.set('calle de alcalá 100');
      store.postalCode.set('28009');
      store.city.set('madrid');
      store.agenda.set([{ id: 'a1', title: 'Cuentas', description: '', hasVote: false }]);
      store.attendees.set([{ email: 'a@x.com', name: 'Ana' }, { email: 'b@x.com' }]);
      store.signerRole.set('secretario');
      store.signerName.set('  Ana Pérez ');

      expect(store.toPayload()).toEqual({
        title: 'Junta ordinaria de enero',
        type: 'extraordinaria',
        scheduledAt1: new Date('2027-01-15T18:00').toISOString(),
        scheduledAt2: new Date('2027-01-15T18:30').toISOString(),
        agenda: [{ id: 'a1', title: 'Cuentas', description: '', hasVote: false }],
        convokedBy: 'cuotas25',
        location: 'Calle de Alcalá 100, 28009, Madrid',
        signerRole: 'secretario',
        signerName: 'Ana Pérez',
        attendeeEmails: ['a@x.com', 'b@x.com'],
        includeJitsi: false,
        telematicBackingConfirmed: undefined,
      });
    });

    it('only sends the telematic confirmation when a video call is included', () => {
      const store = setup();
      fillValidDetails(store);
      store.telematicBackingConfirmed.set(true);
      expect(store.toPayload().telematicBackingConfirmed).toBeUndefined();
      store.includeJitsi.set(true);
      expect(store.toPayload()).toMatchObject({ includeJitsi: true, telematicBackingConfirmed: true });
    });

    it('omits empty optional fields', () => {
      const store = setup();
      fillValidDetails(store);
      expect(store.toPayload().location).toBeUndefined();
      expect(store.toPayload().signerName).toBeUndefined();
    });
  });

  describe('dirty tracking', () => {
    it('is pristine after reset and dirty after an edit', () => {
      const store = setup();
      expect(store.isDirty()).toBe(false);
      store.title.set('Algo');
      expect(store.isDirty()).toBe(true);
    });

    it('treats the preloaded attendees as the baseline once marked pristine', () => {
      const store = setup();
      store.attendees.set([{ email: 'a@x.com' }]);
      expect(store.isDirty()).toBe(true);
      store.markPristine();
      expect(store.isDirty()).toBe(false);
      store.attendees.set([]);
      expect(store.isDirty()).toBe(true);
    });

    it('counts attachments as changes', () => {
      const store = setup();
      store.attachments.set([new File(['x'], 'a.txt', { type: 'text/plain' })]);
      expect(store.isDirty()).toBe(true);
    });
  });

  it('reset restores defaults, including a single blank agenda point', () => {
    const store = setup();
    fillValidDetails(store);
    store.agenda.set([]);
    store.includeJitsi.set(true);
    store.reset();
    expect(store.title()).toBe('');
    expect(store.includeJitsi()).toBe(false);
    expect(store.signerRole()).toBe('administrador');
    expect(store.agenda().length).toBe(1);
    expect(store.agenda()[0].title).toBe('');
  });
});

describe('2ª convocatoria sugerida', () => {
  it('addMinutes adds wall-clock minutes, rolling over hours, days, months and years', () => {
    expect(addMinutes('2027-01-15T18:00', 30)).toBe('2027-01-15T18:30');
    expect(addMinutes('2027-01-15T18:45', 30)).toBe('2027-01-15T19:15');
    expect(addMinutes('2027-01-15T23:45', 30)).toBe('2027-01-16T00:15');
    expect(addMinutes('2027-01-31T23:50', 30)).toBe('2027-02-01T00:20');
    expect(addMinutes('2027-12-31T23:30', 30)).toBe('2028-01-01T00:00');
    expect(addMinutes('', 30)).toBe('');
    expect(addMinutes('2027-01-15', 30)).toBe('');
  });

  it('suggests the 2nd convocation 30 minutes after the 1st', () => {
    const store = setup();
    store.setFirstConvocation('2027-01-15T18:00');
    expect(store.scheduledAt1()).toBe('2027-01-15T18:00');
    expect(store.scheduledAt2()).toBe('2027-01-15T18:30');
    expect(store.secondConvocationSuggested()).toBe(true);
    expect(store.validateDetails()?.field).toBe('title'); // con título, las fechas ya serían válidas
    store.title.set('Junta');
    expect(store.validateDetails()).toBeNull();
  });

  it('keeps following the 1st convocation while the 2nd has not been edited', () => {
    const store = setup();
    store.setFirstConvocation('2027-01-15T18:00');
    store.setFirstConvocation('2027-01-20T19:15');
    expect(store.scheduledAt2()).toBe('2027-01-20T19:45');
  });

  it('never overwrites the 2nd convocation once the user has edited it', () => {
    const store = setup();
    store.setFirstConvocation('2027-01-15T18:00');
    store.setSecondConvocation('2027-01-15T19:30');
    expect(store.secondConvocationSuggested()).toBe(false);
    store.setFirstConvocation('2027-01-16T10:00');
    expect(store.scheduledAt2()).toBe('2027-01-15T19:30');
  });

  it('respects a 2nd convocation set before the 1st, and a cleared one', () => {
    const store = setup();
    store.setSecondConvocation('2027-02-01T12:00');
    store.setFirstConvocation('2027-01-15T18:00');
    expect(store.scheduledAt2()).toBe('2027-02-01T12:00');
    store.setSecondConvocation('');
    store.setFirstConvocation('2027-01-16T18:00');
    expect(store.scheduledAt2()).toBe('');
  });

  it('does not touch the 2nd convocation when the 1st is cleared or incomplete', () => {
    const store = setup();
    store.setFirstConvocation('2027-01-15T18:00');
    store.setFirstConvocation('');
    expect(store.scheduledAt1()).toBe('');
    expect(store.scheduledAt2()).toBe('2027-01-15T18:30');
  });

  it('the user can still make the 2nd convocation invalid (earlier than the 1st) and gets the existing error', () => {
    const store = setup();
    store.title.set('Junta');
    store.setFirstConvocation('2027-01-15T18:00');
    store.setSecondConvocation('2027-01-15T17:00');
    expect(store.validateDetails()?.message).toBe('La 2ª convocatoria debe ser posterior a la 1ª convocatoria.');
  });

  it('reset forgets the manual edit so a new junta suggests again', () => {
    const store = setup();
    store.setSecondConvocation('2027-01-15T19:30');
    store.reset();
    store.setFirstConvocation('2027-03-01T09:00');
    expect(store.scheduledAt2()).toBe('2027-03-01T09:30');
    expect(store.secondConvocationEdited()).toBe(false);
  });

  describe('edit mode', () => {
    const meeting = {
      id: 'm1',
      title: 'Junta de enero',
      type: 'extraordinaria',
      convokedBy: 'cuotas25',
      scheduledAt1: new Date(2027, 0, 15, 18, 0).toISOString(),
      scheduledAt2: new Date(2027, 0, 15, 19, 15).toISOString(),
      location: 'Calle Mayor 1, 28001 Madrid',
      signerRole: 'secretario',
      signerName: 'Ana',
      agenda: [{ id: 'a1', title: 'Cuentas', hasVote: false }],
    } as unknown as Meeting;

    it('loads a meeting into the draft without marking it dirty', () => {
      const store = setup();
      store.loadFromMeeting(meeting);
      expect(store.title()).toBe('Junta de enero');
      expect(store.type()).toBe('extraordinaria');
      expect(store.convokedBy()).toBe('cuotas25');
      expect(store.scheduledAt1()).toBe('2027-01-15T18:00');
      expect(store.scheduledAt2()).toBe('2027-01-15T19:15');
      expect(store.fullAddress()).toBe('Calle Mayor 1, 28001 Madrid');
      expect(store.signerRole()).toBe('secretario');
      expect(store.agenda()).toEqual(meeting.agenda);
      expect(store.isDirty()).toBe(false);
    });

    it('does not let the second convocation follow the first again', () => {
      const store = setup();
      store.loadFromMeeting(meeting);
      store.setFirstConvocation('2027-01-16T10:00');
      expect(store.scheduledAt2()).toBe('2027-01-15T19:15');
    });

    it('builds an update payload with only the convocation data', () => {
      const store = setup();
      store.loadFromMeeting(meeting);
      store.title.set('  Junta nueva ');
      const payload = store.toUpdatePayload();
      expect(payload).toEqual({
        title: 'Junta nueva',
        type: 'extraordinaria',
        scheduledAt1: new Date(2027, 0, 15, 18, 0).toISOString(),
        scheduledAt2: new Date(2027, 0, 15, 19, 15).toISOString(),
        agenda: meeting.agenda,
        convokedBy: 'cuotas25',
        location: 'Calle Mayor 1, 28001 Madrid',
        signerRole: 'secretario',
        signerName: 'Ana',
      });
      expect(payload).not.toHaveProperty('attendeeEmails');
      expect(payload).not.toHaveProperty('includeJitsi');
    });

    it('does not mutate the original agenda when it is edited', () => {
      const store = setup();
      store.loadFromMeeting(meeting);
      store.agenda.update((items) => [{ ...items[0], title: 'Cambiado' }]);
      expect(meeting.agenda[0].title).toBe('Cuentas');
    });
  });
});
