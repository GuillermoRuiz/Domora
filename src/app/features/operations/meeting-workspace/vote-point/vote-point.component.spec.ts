import { setupComponent, settle } from '../../../../core/testing/component-harness';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { VoteSessionsService } from '../../../../core/vote-sessions.service';
import type { AgendaItem, VoteResponseEntry, VoteSession } from '../../../../core/models';
import type { ParticipationRow } from '../meeting-workspace.model';
import { MeetingVotePointComponent } from './vote-point.component';

const item = {
  id: 'a1',
  title: 'Aprobación del presupuesto 2027',
  description: 'Se somete a votación.',
  hasVote: true,
  voteTemplate: {
    questions: [{ title: '¿Aprueba el presupuesto?', type: 'single_choice', options: ['A favor', 'En contra', 'Abstención'] }],
  },
} as unknown as AgendaItem;

const session = (over: Partial<VoteSession> = {}) =>
  ({
    id: 's1',
    agendaItemId: 'a1',
    questionIndex: 0,
    majorityType: 'mayoriaSimple',
    status: 'abierta',
    liveTally: { passed: null, optionTally: [{ optionIndex: 0, propertyCount: 2 }, { optionIndex: 1, propertyCount: 1 }] },
    ...over,
  }) as VoteSession;

const participant = (propertyId: string, unit: string, owner: string, status: ParticipationRow['status']): ParticipationRow =>
  ({ propertyId, unit, owner, initials: owner.slice(0, 2).toUpperCase(), status, statusLabel: status, representedBy: null }) as ParticipationRow;
const participation = [
  participant('p1', '1A', 'Ana Pérez', 'presente'),
  participant('p2', '1B', 'Luis Martín', 'presente'),
  participant('p3', '1C', 'Sara Gil', 'ausente'),
];
const responses: VoteResponseEntry[] = [
  { propertyId: 'p1', propertyRef: '1A', voterName: 'Ana Pérez', registeredByName: null, optionIndex: 0, optionIndexes: [], castAt: '2026-10-22T20:30:00Z' },
];

function setup(opts: { item?: AgendaItem; sessions?: VoteSession[]; canManage?: boolean; listResponses?: () => Promise<VoteResponseEntry[]>; debts?: { propertyId: string; amount: number }[] } = {}) {
  const api = {
    listResponses: vi.fn(opts.listResponses ?? (() => Promise.resolve(responses))),
    open: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue({}),
    registerVote: vi.fn().mockResolvedValue(undefined),
    listDebts: vi.fn().mockResolvedValue(opts.debts ?? []),
  };
  const h = setupComponent(MeetingVotePointComponent, { providers: [{ provide: VoteSessionsService, useValue: api }] });
  h.fixture.componentRef.setInput('meetingId', 'm1');
  h.fixture.componentRef.setInput('item', opts.item ?? item);
  h.fixture.componentRef.setInput('number', 2);
  h.fixture.componentRef.setInput('sessions', opts.sessions ?? [session()]);
  h.fixture.componentRef.setInput('participation', participation);
  h.fixture.componentRef.setInput('canManage', opts.canManage ?? true);
  h.fixture.detectChanges();
  return { h, api };
}
const text = (h: ReturnType<typeof setup>['h']) => h.el.textContent ?? '';

describe('MeetingVotePointComponent', () => {
  it('shows the point on its own with its result', async () => {
    const { h } = setup();
    await settle();
    h.fixture.detectChanges();
    expect(text(h)).toContain('Aprobación del presupuesto 2027');
    expect(text(h)).toContain('02');
    expect(text(h)).toContain('Votación abierta');
    expect(text(h)).toContain('Mayoría simple');
    expect(text(h)).toContain('2 · 67%');
  });

  it('lists what each property voted and who has not voted', async () => {
    const { h, api } = setup();
    await settle();
    h.fixture.detectChanges();
    expect(api.listResponses).toHaveBeenCalledWith('m1', 's1');
    const rows = Array.from(h.el.querySelectorAll('tbody tr')).map((tr) => tr.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('1A');
    expect(rows[0]).toContain('A favor');
    expect(rows[0]).toContain('Ana Pérez');
    expect(rows[1]).toContain('Sin votar');
    expect(rows[2]).toContain('Ausente');
    expect(text(h)).toContain('1 de 3 han votado');
  });

  it('tells the user when the vote detail cannot be loaded', async () => {
    const { h } = setup({ listResponses: () => Promise.reject(new Error('boom')) });
    await settle();
    h.fixture.detectChanges();
    expect(text(h)).toContain('No se pudo cargar el detalle de los votos');
  });

  it('never asks for the majority when starting a vote: an older meeting without it opens with the suggested one', async () => {
    vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
    const { h, api } = setup({ sessions: [], canManage: true });
    const changed = vi.fn();
    h.component.changed.subscribe(changed);
    expect(text(h)).toContain('Todavía no se ha abierto la votación');
    expect(text(h)).toContain('Mayoría simple');
    (h.el.querySelector('.actions app-btn button') as HTMLButtonElement).click();
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('select')).toBeNull();
    expect(text(h)).not.toContain('Sugerencia automática');
    expect(api.open).toHaveBeenCalledWith('m1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple' });
    expect(changed).toHaveBeenCalledWith('Votación abierta.');
  });

  it('hides the start action when the meeting is no longer open', () => {
    const { h } = setup({ sessions: [], canManage: false });
    expect(h.el.querySelector('.actions')).toBeNull();
  });

  it('hides the close action when the meeting is no longer open', () => {
    const { h } = setup({ canManage: false });
    expect(h.el.querySelector('.actions')).toBeNull();
  });
});

describe('MeetingVotePointComponent vote registration', () => {
  const buttons = (h: ReturnType<typeof setup>['h']) =>
    Array.from(h.el.querySelectorAll('tbody tr')).map((tr) => tr.querySelector('.actions-col app-btn button')?.textContent?.trim() ?? null);

  it('offers to register or change the vote of present owners, never of absent ones', async () => {
    const { h } = setup();
    await settle();
    h.fixture.detectChanges();
    // p1 ya votó, p2 está presente sin votar, p3 está ausente
    expect(buttons(h)).toEqual(['Cambiar voto', 'Registrar voto', null]);
  });

  describe('deuda pendiente (art. 15.2 LPH)', () => {
    it('a property with overdue debt shows «Deuda pendiente» instead of «Registrar voto»', async () => {
      const { h } = setup({ debts: [{ propertyId: 'p2', amount: 350.5 }] });
      await settle();
      h.fixture.detectChanges();
      expect(buttons(h)).toEqual(['Cambiar voto', 'Deuda pendiente', null]);
    });

    it('clicking it explains the debt and article 15, and registering is only possible after confirming the override', async () => {
      const ask = vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      const { h, api } = setup({ debts: [{ propertyId: 'p2', amount: 350.5 }] });
      await settle();
      h.fixture.detectChanges();
      (h.el.querySelectorAll('tbody tr')[1].querySelector('.actions-col app-btn button') as HTMLButtonElement).click();
      await settle();
      const options = ask.mock.calls.at(-1)![0];
      expect(options.title).toBe('Deuda pendiente');
      expect(options.message).toContain('350,50');
      expect(options.message).toContain('Art. 15.2 LPH');
      expect(options.message).toContain('constar expresamente en el acta');
      expect(options.tone).toBe('danger');
      expect(api.registerVote).not.toHaveBeenCalled();
      // Confirmado: se abre el registro del voto y, al guardarlo, va con la anulación de la deuda.
      h.fixture.detectChanges();
      await h.component.confirmRegister({ optionIndex: 1 });
      expect(api.registerVote).toHaveBeenCalledWith('m1', 's1', { propertyId: 'p2', optionIndex: 1, overrideDebt: true });
    });

    it('declining the confirmation does not open the vote registration', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
      const { h, api } = setup({ debts: [{ propertyId: 'p2', amount: 10 }] });
      await settle();
      h.fixture.detectChanges();
      (h.el.querySelectorAll('tbody tr')[1].querySelector('.actions-col app-btn button') as HTMLButtonElement).click();
      await settle();
      expect(h.component.registering()).toBeNull();
      expect(api.registerVote).not.toHaveBeenCalled();
    });

    it('without debts the vote is registered normally, with no override flag', async () => {
      const { h, api } = setup();
      await settle();
      h.fixture.detectChanges();
      (h.el.querySelectorAll('tbody tr')[1].querySelector('.actions-col app-btn button') as HTMLButtonElement).click();
      h.fixture.detectChanges();
      await h.component.confirmRegister({ optionIndex: 0 });
      expect(api.registerVote.mock.calls[0][2]).not.toHaveProperty('overrideDebt');
    });
  });

  it('offers nothing once the vote is closed or the meeting can no longer be managed', async () => {
    const closed = setup({ sessions: [session({ status: 'cerrada', resultSummary: { passed: true, optionTally: [] } as never })] });
    await settle();
    closed.h.fixture.detectChanges();
    expect(buttons(closed.h)).toEqual([null, null, null]);
  });

  it('offers nothing when the meeting is no longer open', async () => {
    const { h } = setup({ canManage: false });
    await settle();
    h.fixture.detectChanges();
    expect(buttons(h)).toEqual([null, null, null]);
  });

  it('registers the chosen option for the property and asks the meeting to reload', async () => {
    const { h, api } = setup();
    await settle();
    h.fixture.detectChanges();
    const changed = vi.fn();
    h.component.changed.subscribe(changed);
    (h.el.querySelectorAll('tbody tr')[1].querySelector('.actions-col app-btn button') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    const modal = document.body.querySelector('app-meeting-vote-registration-modal') as HTMLElement;
    expect(modal.textContent).toContain('Registrar voto');
    expect(modal.textContent).toContain('Luis Martín');
    (modal.querySelectorAll('input')[1] as HTMLInputElement).click();
    h.fixture.detectChanges();
    const footer = Array.from(modal.querySelectorAll('.modal__footer button')).pop() as HTMLButtonElement;
    footer.click();
    await settle();
    expect(api.registerVote).toHaveBeenCalledWith('m1', 's1', { propertyId: 'p2', optionIndex: 1 });
    expect(changed).toHaveBeenCalledWith('Voto de la propiedad 1B registrado.');
  });

  it('shows the API error and keeps the dialog open when the vote is rejected', async () => {
    const { h, api } = setup();
    api.registerVote.mockRejectedValueOnce({ error: { message: 'Solo se puede registrar o cambiar un voto mientras la votación está abierta.' } });
    await settle();
    h.fixture.detectChanges();
    (h.el.querySelectorAll('tbody tr')[1].querySelector('.actions-col app-btn button') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    h.component.registering.set({ ...h.component.registering()! });
    await h.component.confirmRegister({ optionIndex: 0 });
    h.fixture.detectChanges();
    expect(h.component.registerError()).toContain('mientras la votación está abierta');
    expect(h.component.registering()).not.toBeNull();
  });
});

describe('MeetingVotePointComponent opening with the majority fixed in the meeting', () => {
  const fixed = {
    ...item,
    voteTemplate: { questions: [{ ...(item.voteTemplate!.questions[0]), majorityType: 'tresQuintos' }] },
  } as unknown as AgendaItem;

  it('shows the chosen majority and opens the vote directly after confirming, without asking for it again', async () => {
    vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
    const { h, api } = setup({ item: fixed, sessions: [] });
    const changed = vi.fn();
    h.component.changed.subscribe(changed);
    expect(h.el.textContent).toContain('Tres quintas partes');
    (h.el.querySelector('.actions app-btn button') as HTMLButtonElement).click();
    await settle();
    expect(h.el.querySelector('select')).toBeNull();
    expect(api.open).toHaveBeenCalledWith('m1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'tresQuintos' });
    expect(changed).toHaveBeenCalledWith('Votación abierta.');
  });

  it('does not open anything when the confirmation is declined', async () => {
    vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
    const { h, api } = setup({ item: fixed, sessions: [] });
    (h.el.querySelector('.actions app-btn button') as HTMLButtonElement).click();
    await settle();
    expect(api.open).not.toHaveBeenCalled();
  });
});
