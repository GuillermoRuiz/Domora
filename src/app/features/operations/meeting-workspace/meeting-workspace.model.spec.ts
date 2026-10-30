import type {
  Meeting,
  MeetingAttendee,
  MeetingVoteDelegation,
  OwnerProperty,
  QuorumResult,
  VoteResponseEntry,
  VoteSession,
} from '../../../core/models';
import {
  actaEditable,
  actaSigners,
  actaStatus,
  agendaRows,
  attachmentKind,
  formatFileSize,
  formatShortDate,
  formatPercent,
  initialsOf,
  meetingHeld,
  participationRows,
  participationStats,
  pointQuestions,
  voteRows,
  type MeetingData,
} from './meeting-workspace.model';

const meeting = {
  id: 'm1',
  estateId: 'e1',
  title: 'Junta ordinaria',
  status: 'convocada',
  scheduledAt1: '2026-10-22T21:59:00Z',
  scheduledAt2: '2026-10-22T22:29:00Z',
  agenda: [
    {
      id: 'a1',
      title: 'Aprobación del presupuesto',
      hasVote: true,
      voteTemplate: {
        questions: [
          { title: '¿Aprueba?', type: 'single_choice', options: ['A favor', 'En contra', 'Abstención'] },
        ],
      },
    },
    { id: 'a2', title: 'Ruegos y preguntas' },
  ],
} as unknown as Meeting;
const property = (id: string, ref: string, quota: number | null) =>
  ({ id, ref, participationQuota: quota }) as OwnerProperty;
const attendee = (id: string, propertyId: string, userId: string, name: string) =>
  ({ id, propertyId, userId, displayName: name, source: 'manual', joinedAt: '2026-10-22T20:00:00Z' }) as MeetingAttendee;
const delegation = (over: Partial<MeetingVoteDelegation> = {}) =>
  ({
    id: 'd1',
    propertyId: 'p2',
    representativeUserId: 'u1',
    createdAt: '2026-10-22T20:10:00Z',
    delegatorUser: { fullName: 'Luis Martín', email: '' },
    representativeUser: { fullName: 'Ana Pérez', email: '' },
    ...over,
  }) as MeetingVoteDelegation;
const session = (over: Partial<VoteSession> = {}) =>
  ({
    id: 's1',
    agendaItemId: 'a1',
    questionIndex: 0,
    majorityType: 'mayoriaSimple',
    status: 'cerrada',
    openedAt: '2026-10-22T20:20:00Z',
    closedAt: '2026-10-22T20:40:00Z',
    resultSummary: {
      passed: true,
      optionTally: [
        { optionIndex: 0, propertyCount: 16 },
        { optionIndex: 1, propertyCount: 4 },
        { optionIndex: 2, propertyCount: 1 },
      ],
    },
    ...over,
  }) as VoteSession;
const quorum = {
  quorumRequired: true,
  quorumMet: true,
  owners: { present: 2, total: 3, percent: 66.7 },
  quota: { present: 8, total: 12, percent: 72.4 },
} as QuorumResult;
const data = (over: Partial<MeetingData> = {}): MeetingData => ({
  meeting,
  quorum,
  attendance: [
    attendee('t1', 'p1', 'u1', 'Ana Pérez'),
    attendee('t2', 'p2', 'u1', 'Ana Pérez'),
  ],
  properties: [property('p1', '1A', 4.2), property('p2', '2B', 3.8), property('p3', 'Bajo C', null)],
  delegations: [delegation()],
  voteSessions: [],
  attachments: [],
  ...over,
});

describe('meeting workspace model', () => {
  it('formats percentages in es-ES and tolerates missing values', () => {
    expect(formatPercent(72.4)).toBe('72,4%');
    expect(formatPercent(null)).toBe('—');
  });

  it('derives initials from the owner name', () => {
    expect(initialsOf('Ana Pérez')).toBe('AP');
    expect(initialsOf('Sofía')).toBe('S');
    expect(initialsOf('')).toBe('·');
  });

  describe('participation', () => {
    it('marks present, represented and absent owners', () => {
      const rows = participationRows(data());
      expect(rows.map((row) => row.status)).toEqual(['presente', 'representado', 'ausente']);
      expect(rows[1]).toMatchObject({ owner: 'Luis Martín', representedBy: 'Ana Pérez', quota: '3,8%' });
      expect(rows[2]).toMatchObject({ hasVote: false, voteLabel: 'Sin registrar', quota: '—' });
    });

    it('shows the name of the holder instead of "Titular de…", and lets a chosen holder win when several', () => {
      const holders = [
        { propertyId: 'p3', holders: [{ userId: 'h1', name: 'Marta Vega' }, { userId: 'h2', name: 'Pablo Ruiz' }] },
      ];
      const [, , absent] = participationRows(data({ holders }));
      expect(absent).toMatchObject({ owner: 'Marta Vega', holderUserId: 'h1' });
      expect(absent.holders?.map((holder) => holder.name)).toEqual(['Marta Vega', 'Pablo Ruiz']);
      const [, , chosen] = participationRows(data({ holders }), { p3: 'h2' });
      expect(chosen).toMatchObject({ owner: 'Pablo Ruiz', holderUserId: 'h2' });
    });

    it('keeps the holder who attends as the selected one and falls back to "Titular de…" without holders', () => {
      const holders = [{ propertyId: 'p1', holders: [{ userId: 'h0', name: 'Otra Persona' }, { userId: 'u1', name: 'Ana Pérez' }] }];
      const [present, , absent] = participationRows(data({ holders }), { p1: 'h0' });
      expect(present).toMatchObject({ owner: 'Ana Pérez', holderUserId: 'u1' });
      expect(absent.owner).toBe('Titular de Bajo C');
      expect(absent.holderUserId).toBeNull();
    });

    it('treats an active delegation as represented even if the representative has not arrived', () => {
      const rows = participationRows(data({ attendance: [] }));
      expect(rows[1]).toMatchObject({ status: 'representado', representedBy: 'Ana Pérez', hasVote: true });
    });

    it('shows the name and DNI of an external representative without an account', () => {
      const rows = participationRows(
        data({
          attendance: [],
          delegations: [
            delegation({
              representativeUserId: null,
              representativeUser: null,
              representativeName: 'Marta Gil',
              representativeDni: '12345678Z',
            }),
          ],
        }),
      );
      expect(rows[1]).toMatchObject({
        status: 'representado',
        representedBy: 'Marta Gil',
        representedByDni: '12345678Z',
        delegationId: 'd1',
        representativeAttendanceIds: [],
      });
    });

    it('exposes the attendance ids needed to undo a roll call', () => {
      const rows = participationRows(data());
      expect(rows[0].attendanceIds).toEqual(['t1']);
      expect(rows[1]).toMatchObject({ attendanceIds: ['t2'], representativeAttendanceIds: ['t2'] });
      expect(rows[2].attendanceIds).toEqual([]);
    });

    it('ignores revoked delegations', () => {
      const rows = participationRows(
        data({ delegations: [delegation({ revokedAt: '2026-10-22T20:30:00Z' })] }),
      );
      expect(rows[1].representedBy).toBeNull();
      expect(rows[1].status).toBe('presente');
    });

    it('summarises quorum, representation and the share of neighbours present', () => {
      const d = data();
      const stats = participationStats(d, participationRows(d));
      expect(stats).toMatchObject({
        attending: 2,
        totalOwners: 3,
        represented: 1,
        ownersPercent: 66.7,
        quotaPercent: 72.4,
        quorumTone: 'green',
        quorumLabel: 'Quórum alcanzado',
      });
    });

    it('reports a missing quorum and a second call without one', () => {
      const missing = data({ quorum: { ...quorum, quorumMet: false } });
      expect(participationStats(missing, []).quorumTone).toBe('red');
      const second = data({ quorum: { ...quorum, quorumRequired: false } });
      expect(participationStats(second, []).quorumLabel).toBe('Sin quórum exigible');
    });

  });


  describe('vote point', () => {
    const response = (over: Partial<VoteResponseEntry>): VoteResponseEntry => ({
      propertyId: 'p1',
      propertyRef: '1A',
      voterName: 'Ana Pérez',
      registeredByName: null,
      optionIndex: 0,
      optionIndexes: [],
      castAt: '2026-10-22T20:30:00Z',
      ...over,
    });

    it('lists the votable questions of a point with their session', () => {
      const [question] = pointQuestions(meeting.agenda[0], [session()]);
      expect(question).toMatchObject({ questionIndex: 0, title: '¿Aprueba?', options: ['A favor', 'En contra', 'Abstención'] });
      expect(question.session?.id).toBe('s1');
      expect(pointQuestions(meeting.agenda[0], [])[0].session).toBeNull();
      expect(pointQuestions(meeting.agenda[1], [])).toEqual([]);
      const fixed = { ...meeting.agenda[0], voteTemplate: { questions: [{ ...meeting.agenda[0].voteTemplate!.questions[0], majorityType: 'unanimidad' as const }] } };
      expect(pointQuestions(fixed, [])[0].majorityType).toBe('unanimidad');
    });

    it('prefers the open session over an older closed one', () => {
      const open = session({ id: 's2', status: 'abierta' });
      expect(pointQuestions(meeting.agenda[0], [open, session()])[0].session?.id).toBe('s2');
    });

    it('shows what each property voted, who cast it and who has not voted yet', () => {
      const d = data();
      const rows = voteRows(
        participationRows(d),
        [response({ propertyId: 'p1', optionIndex: 1 }), response({ propertyId: 'p2', voterName: 'Ana Pérez', optionIndex: 0 })],
        ['A favor', 'En contra', 'Abstención'],
      );
      expect(rows[0]).toMatchObject({ unit: '1A', state: 'voted', choice: 'En contra', voter: 'Ana Pérez' });
      expect(rows[1]).toMatchObject({ unit: '2B', state: 'voted', choice: 'A favor' });
      // p3 no está en la junta
      expect(rows[2]).toMatchObject({ unit: 'Bajo C', state: 'absent', choice: null, voter: null });
    });

    it('keeps who registered a vote and the chosen options so they can be changed', () => {
      const [first, second] = voteRows(
        participationRows(data()),
        [response({ propertyId: 'p1', optionIndex: 2, registeredByName: 'Gestora' })],
        ['A favor', 'En contra', 'Abstención'],
      );
      expect(first).toMatchObject({ selected: [2], registeredBy: 'Gestora' });
      expect(second).toMatchObject({ selected: [], registeredBy: null, representedBy: 'Ana Pérez' });
    });

    it('colours the vote: in favour green, against red, anything else blue', () => {
      const options = ['A favor', 'En contra', 'Abstención'];
      const rows = voteRows(
        participationRows(data({ attendance: [attendee('t1', 'p1', 'u1', 'Ana'), attendee('t2', 'p2', 'u1', 'Ana'), attendee('t3', 'p3', 'u1', 'Ana')] })),
        [
          response({ propertyId: 'p1', optionIndex: 0 }),
          response({ propertyId: 'p2', optionIndex: 1 }),
          response({ propertyId: 'p3', optionIndex: 2 }),
        ],
        options,
      );
      expect(rows.map((row) => row.choiceTone)).toEqual(['green', 'red', 'blue']);
      const multiple = voteRows(participationRows(data()), [response({ propertyId: 'p1', optionIndex: null, optionIndexes: [0] })], options, 'multiple_choice');
      expect(multiple[0].choiceTone).toBe('blue');
    });

    it('marks present owners who have not voted as pending, and joins multiple choices', () => {
      const rows = voteRows(
        participationRows(data()),
        [response({ propertyId: 'p2', optionIndex: null, optionIndexes: [0, 2] })],
        ['A favor', 'En contra', 'Abstención'],
      );
      expect(rows[0].state).toBe('pending');
      expect(rows[1].choice).toBe('A favor, Abstención');
    });
  });

  describe('agenda — tratado y comentarios', () => {
    const withAgenda = (agenda: unknown[], over: Record<string, unknown> = {}) =>
      data({ meeting: { ...meeting, ...over, agenda } as unknown as Meeting });

    it('a point without a vote can be marked as treated while the meeting is open, and then shows as treated', () => {
      const [pending] = agendaRows(withAgenda([{ id: 'r', title: 'Ruegos' }]));
      expect(pending).toMatchObject({ votable: false, canMarkTreated: true, statusLabel: 'Pendiente' });
      const [done] = agendaRows(withAgenda([{ id: 'r', title: 'Ruegos', treatedAt: '2026-10-22T20:00:00Z' }]));
      expect(done).toMatchObject({ canMarkTreated: false, canUnmarkTreated: true, statusLabel: 'Tratado', hint: 'Punto tratado', tone: 'green' });
      expect(pending.canUnmarkTreated).toBe(false);
    });

    it('a point with a vote is never marked by hand, and a closed meeting cannot mark points', () => {
      const [voted] = agendaRows(data());
      expect(voted).toMatchObject({ votable: true, canMarkTreated: false });
      const [celebrated] = agendaRows(withAgenda([{ id: 'r', title: 'Ruegos' }], { status: 'celebrada' }));
      expect(celebrated.canMarkTreated).toBe(false);
      const [lockedTreated] = agendaRows(withAgenda([{ id: 'r', title: 'Ruegos', treatedAt: '2026-10-22T20:00:00Z' }], { status: 'celebrada' }));
      expect(lockedTreated.canUnmarkTreated).toBe(false);
    });

    it('exposes the comments and whether they can still be edited', () => {
      const [row] = agendaRows(withAgenda([{ id: 'r', title: 'Ruegos', comments: '  Intervino 2B  ' }]));
      expect(row).toMatchObject({ comments: 'Intervino 2B', canComment: true });
      expect(agendaRows(withAgenda([{ id: 'r', title: 'R' }], { status: 'cancelada' }))[0].canComment).toBe(false);
      expect(agendaRows(withAgenda([{ id: 'r', title: 'R' }], { status: 'firmada', actaSignedAt: '2026-10-23' }))[0].canComment).toBe(false);
      expect(agendaRows(withAgenda([{ id: 'r', title: 'R' }], { status: 'celebrada' }))[0].canComment).toBe(true);
    });

  });

  describe('agenda', () => {
    it('shows a votable point as pending until it is voted', () => {
      const [first, second] = agendaRows(data());
      expect(first).toMatchObject({ number: '01', statusLabel: 'Pendiente de votación', canStartVote: true });
      expect(second).toMatchObject({ number: '02', statusLabel: 'Pendiente', hint: 'Aún no se ha tratado', canStartVote: false });
    });

    it('shows live counts while a vote is open', () => {
      const open = session({
        status: 'abierta',
        closedAt: null,
        resultSummary: null,
        liveTally: { passed: null, optionTally: [{ optionIndex: 0, propertyCount: 14 }, { optionIndex: 1, propertyCount: 2 }] },
      } as Partial<VoteSession>);
      const [first] = agendaRows(data({ voteSessions: [open] }));
      expect(first).toMatchObject({ statusLabel: 'En votación', tone: 'yellow', canStartVote: false, canCloseVote: true });
      expect(first.tally.map((option) => option.count)).toEqual([14, 2, 0]);
    });

    it('marks a closed vote as completed with its outcome', () => {
      const [first] = agendaRows(data({ voteSessions: [session()] }));
      expect(first).toMatchObject({ statusLabel: 'Completado', result: { label: 'Aprobado', tone: 'green' } });
      const [rejected] = agendaRows(
        data({ voteSessions: [session({ resultSummary: { ...session().resultSummary!, passed: false } })] }),
      );
      expect(rejected.result).toEqual({ label: 'Rechazado', tone: 'red' });
    });

    it('does not offer to start a vote that is already closed', () => {
      const [first, second] = agendaRows(data({ voteSessions: [session()] }));
      expect(first).toMatchObject({ canStartVote: false, voteClosed: true });
      expect(second.voteClosed).toBe(false);
    });
  });

  describe('acta', () => {
    it('a signed meeting counts as held but its acta can no longer be edited', () => {
      expect(['convocada', 'celebrada', 'firmada', 'cancelada'].map((status) => meetingHeld({ status } as Meeting))).toEqual([false, true, true, false]);
      expect(['convocada', 'celebrada', 'firmada', 'cancelada'].map((status) => actaEditable({ status } as Meeting))).toEqual([true, true, false, false]);
    });

    it('follows the meeting lifecycle', () => {
      expect(actaStatus(meeting).phase).toBe('draft');
      expect(actaStatus({ ...meeting, status: 'celebrada' }).phase).toBe('pending-signature');
      expect(actaStatus({ ...meeting, status: 'firmada', actaSignedAt: '2026-10-23' }).phase).toBe('signed');
      expect(actaStatus({ ...meeting, status: 'firmada' }).phase).toBe('signed');
      expect(actaStatus({ ...meeting, status: 'cancelada' }).phase).toBe('unavailable');
    });

    it('lists which signers are pending', () => {
      const signed = { ...meeting, actaSignedByPresidenteUserId: 'u1' } as Meeting;
      expect(actaSigners(signed)).toEqual([
        { role: 'Presidente', signed: true },
        { role: 'Secretario / Administrador', signed: false },
      ]);
    });

  });

  describe('attachments', () => {
    it('classifies by MIME type and falls back to the extension', () => {
      expect(attachmentKind({ title: 'a.pdf', mimeType: 'application/pdf' })).toEqual({ label: 'PDF', tone: 'pdf' });
      expect(attachmentKind({ title: 'b.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).label).toBe('Excel');
      expect(attachmentKind({ title: 'Presupuesto.XLS', mimeType: null }).label).toBe('Excel');
      expect(attachmentKind({ title: 'c.docx', mimeType: null }).label).toBe('Word');
      expect(attachmentKind({ title: 'foto.png', mimeType: 'image/png' }).label).toBe('Imagen');
      expect(attachmentKind({ title: 'notas', mimeType: null })).toEqual({ label: 'Archivo', tone: 'file' });
    });

    it('formats sizes and dates for the list', () => {
      expect(formatFileSize(null)).toBe('');
      expect(formatFileSize(512)).toBe('512 B');
      expect(formatFileSize(245 * 1024)).toBe('245 KB');
      expect(formatFileSize(1.2 * 1024 * 1024)).toBe('1,2 MB');
      expect(formatShortDate('2027-01-10T12:00:00Z')).toBe('10 ene 2027');
      expect(formatShortDate(null)).toBe('—');
    });
  });
});
