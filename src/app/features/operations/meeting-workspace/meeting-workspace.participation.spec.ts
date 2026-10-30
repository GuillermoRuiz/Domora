import { TestBed } from '@angular/core/testing';
import { setupComponent } from '../../../core/testing/component-harness';
import { MeetingsService } from '../../../core/meetings.service';
import { PropertiesService } from '../../../core/properties.service';
import { MeetingVoteDelegationsService } from '../../../core/meeting-vote-delegations.service';
import { VoteSessionsService } from '../../../core/vote-sessions.service';
import type { OperationRow } from '../../../core/operations.service';
import { MeetingWorkspaceComponent } from './meeting-workspace.component';
import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import type { AgendaRow, ParticipationRow } from './meeting-workspace.model';

const calls: string[] = [];
const track = <T>(name: string, result: T) =>
  vi.fn((...args: unknown[]) => {
    calls.push(`${name}(${args.slice(1).join(',')})`);
    return Promise.resolve(result);
  });

const row = (over: Partial<ParticipationRow> = {}): ParticipationRow => ({
  propertyId: 'p1',
  owner: 'Ana Pérez',
  initials: 'AP',
  unit: '1A',
  status: 'ausente',
  statusLabel: 'Ausente',
  representedBy: null,
  representedByDni: null,
  delegationId: null,
  representativeUserId: null,
  attendanceIds: [],
  representativeAttendanceIds: [],
  quota: '4%',
  quotaValue: 4,
  group: '',
  hasVote: false,
  voteLabel: '',
  ...over,
});

function setup(eligible: { userId: string; name: string; kind: 'own' | 'delegated' }[] = [{ userId: 'u-owner', name: 'Ana', kind: 'own' }]) {
  calls.length = 0;
  const meetings = {
    findMeetingById: vi.fn().mockResolvedValue({ id: 'm1', status: 'convocada', agenda: [], title: 'Junta' }),
    getMeetingQuorum: vi.fn().mockResolvedValue(null),
    listMeetingAttendance: vi.fn().mockResolvedValue([]),
    listMeetingAttachments: vi.fn().mockResolvedValue([]),
    listRollCallHolders: vi.fn().mockResolvedValue([]),
    listRollCallEligible: vi.fn().mockResolvedValue(eligible),
    markRollCall: track('markRollCall', {}),
    undoRollCall: track('undoRollCall', undefined),
    markAgendaItemTreated: track('markAgendaItemTreated', {}),
    clearAgendaItemTreated: track('clearAgendaItemTreated', {}),
    setAgendaItemComments: track('setAgendaItemComments', {}),
    listEstateOwnerEmails: vi.fn().mockResolvedValue([
      { email: 'luis@x.com', fullName: 'Luis Martín', isOwner: true },
      { email: 'inq@x.com', fullName: 'Inquilino', isOwner: false },
    ]),
  };
  const delegations = {
    list: vi.fn().mockResolvedValue([]),
    revoke: track('revoke', {}),
    create: track('create', {}),
  };
  const h = setupComponent(MeetingWorkspaceComponent, {
    providers: [
      { provide: MeetingsService, useValue: meetings },
      { provide: PropertiesService, useValue: { listPropertiesByEstate: vi.fn().mockResolvedValue([]) } },
      { provide: MeetingVoteDelegationsService, useValue: delegations },
      { provide: VoteSessionsService, useValue: { list: vi.fn().mockResolvedValue([]) } },
    ],
  });
  h.fixture.componentRef.setInput('row', {
    id: 'm1',
    title: 'Junta',
    status: 'convocada',
    statusLabel: 'Convocada',
    estate: { id: 'e1', name: 'Comunidad' },
  } as unknown as OperationRow);
  h.fixture.detectChanges();
  const changed = vi.fn();
  const failed = vi.fn();
  h.component.changed.subscribe(changed);
  h.component.failed.subscribe(failed);
  return { h, meetings, delegations, changed, failed };
}

describe('MeetingWorkspaceComponent live refresh', () => {
  afterEach(() => vi.useRealTimers());

  it('refreshes every 5 s while a point with an open vote is shown, and every 20 s otherwise', async () => {
    vi.useFakeTimers();
    const { h, meetings } = setup();
    meetings.findMeetingById.mockResolvedValue({
      id: 'm1',
      status: 'convocada',
      title: 'Junta',
      agenda: [{ id: 'a1', title: 'Presupuesto' }],
    });
    const sessions = TestBed.inject(VoteSessionsService) as unknown as { list: ReturnType<typeof vi.fn> };
    sessions.list.mockResolvedValue([{ id: 's1', agendaItemId: 'a1', questionIndex: 0, status: 'abierta' }]);
    await vi.advanceTimersByTimeAsync(0);
    await h.component.load(false);
    const baseline = () => meetings.findMeetingById.mock.calls.length;

    // Sin mirar ningún punto: solo cada 20 s
    const before = baseline();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(baseline()).toBe(before);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(baseline()).toBe(before + 1);

    // Mirando el punto con la votación abierta: cada 5 s
    h.component.openPoint({ id: 'a1' } as AgendaRow);
    const opened = baseline();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(baseline()).toBe(opened + 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(baseline()).toBe(opened + 2);
  });
});

describe('MeetingWorkspaceComponent participation actions', () => {
  it('marks a represented property present: revokes, removes the representative and passes the roll call', async () => {
    const { h, changed } = setup();
    await h.component.markPresent(
      row({ status: 'representado', delegationId: 'd1', attendanceIds: ['a1'], representativeAttendanceIds: ['a1'] }),
    );
    expect(calls).toEqual(['revoke(d1,Representación retirada)', 'undoRollCall(a1)', 'markRollCall(p1,u-owner)']);
    expect(changed).toHaveBeenCalledWith('Propiedad 1A marcada como presente.');
  });

  it('marks present the holder shown in the row without asking who it is', async () => {
    const { h, meetings } = setup();
    await h.component.markPresent(row({ holders: [{ userId: 'h1', name: 'Marta' }, { userId: 'h2', name: 'Pablo' }], holderUserId: 'h2' }));
    expect(calls).toEqual(['markRollCall(p1,h2)']);
    expect(meetings.listRollCallEligible).not.toHaveBeenCalled();
  });

  it('only remembers the chosen holder of an absent property, and swaps the attendee of a present one', async () => {
    const { h, changed } = setup();
    const holders = [{ userId: 'h1', name: 'Marta' }, { userId: 'h2', name: 'Pablo' }];
    await h.component.chooseHolder(row({ status: 'ausente', holders, holderUserId: 'h1' }), 'h2');
    expect(calls).toEqual([]);
    await h.component.chooseHolder(row({ status: 'presente', holders, holderUserId: 'h1', attendanceIds: ['a1'] }), 'h2');
    expect(calls).toEqual(['markRollCall(p1,h2)', 'undoRollCall(a1)']);
    expect(changed).toHaveBeenCalledWith('Propiedad 1A: asiste Pablo.');
  });

  it('does not revoke anything when the property has no linked holder to mark present', async () => {
    const { h, failed, changed } = setup([]);
    await h.component.markPresent(row({ status: 'representado', delegationId: 'd1' }));
    expect(calls).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(expect.stringContaining('no tiene ningún titular vinculado'));
  });

  it('marks a present property absent by undoing every attendance', async () => {
    const { h, changed } = setup();
    await h.component.markAbsent(row({ status: 'presente', attendanceIds: ['a1', 'a2'] }));
    expect(calls).toEqual(['undoRollCall(a1)', 'undoRollCall(a2)']);
    expect(changed).toHaveBeenCalledWith('Propiedad 1A marcada como ausente.');
  });

  it('marks a represented property absent: revokes and clears the attendance', async () => {
    const { h } = setup();
    await h.component.markAbsent(row({ status: 'representado', delegationId: 'd1', attendanceIds: ['a1'] }));
    expect(calls).toEqual(['revoke(d1,Titular ausente)', 'undoRollCall(a1)']);
  });

  it('removes a representation but keeps the owner own attendance', async () => {
    const { h, changed } = setup();
    await h.component.removeRepresentation(
      row({ status: 'representado', delegationId: 'd1', attendanceIds: ['own', 'rep'], representativeAttendanceIds: ['rep'] }),
    );
    expect(calls).toEqual(['revoke(d1,Representación retirada)', 'undoRollCall(rep)']);
    expect(changed).toHaveBeenCalledWith('Representación de la propiedad 1A eliminada.');
  });

  it('opens the modal listing only community owners as possible representatives', async () => {
    const { h } = setup();
    h.component.openRepresentation(row());
    await vi.waitFor(() => expect(h.component.owners()).not.toBeNull());
    expect(h.component.owners()).toEqual([{ email: 'luis@x.com', fullName: 'Luis Martín', isOwner: true }]);
    expect(h.component.representing()?.propertyId).toBe('p1');
  });

  it('registers an external representative with name and DNI, on behalf of the property holder', async () => {
    const { h, delegations, changed } = setup();
    h.component.openRepresentation(row({ status: 'representado', representativeAttendanceIds: ['old'] }));
    await h.component.confirmRepresentation({ owner: null, external: { name: 'Marta Gil', dni: '12345678Z' } });
    expect(delegations.create).toHaveBeenCalledWith('m1', {
      propertyId: 'p1',
      delegatorUserId: 'u-owner',
      representativeName: 'Marta Gil',
      representativeDni: '12345678Z',
    });
    expect(calls).toContain('undoRollCall(old)');
    expect(h.component.representing()).toBeNull();
    expect(changed).toHaveBeenCalledWith('Representante de la propiedad 1A cambiado.');
  });

  it('registers a community owner as representative by email', async () => {
    const { h, delegations } = setup();
    h.component.openRepresentation(row());
    await h.component.confirmRepresentation({ owner: { email: 'luis@x.com' }, external: null });
    expect(delegations.create).toHaveBeenCalledWith('m1', {
      propertyId: 'p1',
      delegatorUserId: 'u-owner',
      representativeEmail: 'luis@x.com',
    });
  });

  it('keeps the modal open and shows the API error when the delegation is rejected', async () => {
    const { h, delegations, changed } = setup();
    delegations.create.mockRejectedValueOnce({ error: { message: 'No puedes delegarte el voto a ti mismo.' } });
    h.component.openRepresentation(row());
    await h.component.confirmRepresentation({ owner: { email: 'ana@x.com' }, external: null });
    expect(h.component.representationError()).toBe('No puedes delegarte el voto a ti mismo.');
    expect(h.component.representing()).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(h.component.busy()).toBe(false);
  });
});

describe('MeetingWorkspaceComponent agenda points', () => {
  const point = { id: 'a1', title: 'Ruegos y preguntas' } as AgendaRow;

  it('marks a point as treated only after confirming in the app dialog', async () => {
    const ask = vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
    const { h, changed } = setup();
    await vi.waitFor(() => expect(h.component.convocada()).toBe(true));
    await h.component.markPointTreated(point);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Marcar punto como tratado' }));
    expect(calls).toContain('markAgendaItemTreated(a1)');
    expect(changed).toHaveBeenCalledWith('Punto marcado como tratado.');
  });

  it('does nothing when the confirmation is declined', async () => {
    vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
    const { h } = setup();
    await vi.waitFor(() => expect(h.component.convocada()).toBe(true));
    await h.component.markPointTreated(point);
    expect(calls).toEqual([]);
  });

  it('removes the treated mark without asking for confirmation and reloads', async () => {
    const ask = vi.spyOn(ConfirmDialogService.prototype, 'ask');
    ask.mockClear();
    const { h, changed } = setup();
    await vi.waitFor(() => expect(h.component.convocada()).toBe(true));
    await h.component.unmarkPointTreated(point);
    expect(ask).not.toHaveBeenCalled();
    expect(calls).toContain('clearAgendaItemTreated(a1)');
    expect(changed).toHaveBeenCalledWith('Marca de tratado quitada.');
  });

  it('reports the error when the mark cannot be removed', async () => {
    const { h, meetings, failed } = setup();
    await vi.waitFor(() => expect(h.component.convocada()).toBe(true));
    meetings.clearAgendaItemTreated.mockRejectedValueOnce({ error: { message: 'La junta ya está celebrada: no se pueden cambiar sus puntos.' } });
    await h.component.unmarkPointTreated(point);
    expect(failed).toHaveBeenCalledWith('La junta ya está celebrada: no se pueden cambiar sus puntos.');
  });

  it('saves the comments of a point, closes the modal and reloads', async () => {
    const { h, meetings, changed } = setup();
    h.component.openComments({ ...point, comments: '' });
    expect(h.component.commenting()?.id).toBe('a1');
    const loads = meetings.findMeetingById.mock.calls.length;
    await h.component.saveComments('Se aprueba con una reserva.');
    expect(calls).toContain('setAgendaItemComments(a1,Se aprueba con una reserva.)');
    expect(h.component.commenting()).toBeNull();
    expect(meetings.findMeetingById.mock.calls.length).toBeGreaterThan(loads);
    expect(changed).toHaveBeenCalledWith('Comentarios guardados.');
  });

  it('says the comments were deleted when saving an empty text', async () => {
    const { h, changed } = setup();
    h.component.openComments({ ...point, comments: 'Antes' });
    await h.component.saveComments('  ');
    expect(changed).toHaveBeenCalledWith('Comentarios eliminados.');
  });

  it('keeps the modal open and shows the API error when the comments cannot be saved', async () => {
    const { h, meetings } = setup();
    meetings.setAgendaItemComments.mockRejectedValueOnce({ error: { message: 'El acta ya está firmada: no se pueden cambiar los comentarios de los puntos.' } });
    h.component.openComments(point);
    await h.component.saveComments('x');
    expect(h.component.commentsError()).toContain('El acta ya está firmada');
    expect(h.component.commenting()).not.toBeNull();
    expect(h.component.busy()).toBe(false);
  });
});
