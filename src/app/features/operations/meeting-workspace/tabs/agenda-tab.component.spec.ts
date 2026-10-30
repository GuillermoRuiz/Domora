import { setupComponent } from '../../../../core/testing/component-harness';
import type { AgendaRow } from '../meeting-workspace.model';
import { MeetingAgendaTabComponent } from './agenda-tab.component';

const row = (over: Partial<AgendaRow>): AgendaRow => ({
  id: 'a1',
  number: '01',
  title: 'Aprobación del acta anterior',
  description: '',
  tone: 'muted',
  statusLabel: 'Pendiente',
  hint: '',
  result: null,
  tally: [],
  canStartVote: false,
  noParticipants: false,
  voteClosed: false,
  canCloseVote: false,
  votable: true,
  canMarkTreated: false,
  canUnmarkTreated: false,
  comments: '',
  canComment: true,
  ...over,
});

function setup(over: Partial<AgendaRow>) {
  const h = setupComponent(MeetingAgendaTabComponent);
  h.fixture.componentRef.setInput('rows', [row(over)]);
  h.fixture.detectChanges();
  // El detalle de cada punto se despliega al pulsarlo.
  (h.el.querySelector('.item__main') as HTMLButtonElement).click();
  h.fixture.detectChanges();
  const button = h.el.querySelector('.actions app-btn button') as HTMLButtonElement;
  return { h, button };
}

describe('MeetingAgendaTabComponent main action', () => {
  const labels = (h: ReturnType<typeof setup>['h']) =>
    Array.from(h.el.querySelectorAll('.actions app-btn button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());

  it('starts a vote that can be started straight from the list, and still offers to view it', () => {
    const { h } = setup({ canStartVote: true });
    expect(labels(h)).toEqual(['Iniciar votación', 'Ver votación', 'Comentarios']);
    const startVote = vi.fn();
    const openPoint = vi.fn();
    h.component.startVote.subscribe(startVote);
    h.component.openPoint.subscribe(openPoint);
    const buttons = h.el.querySelectorAll<HTMLButtonElement>('.actions app-btn button');
    expect(buttons[0].disabled).toBe(false);
    buttons[0].click();
    expect(startVote).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
    expect(openPoint).not.toHaveBeenCalled();
    buttons[1].click();
    expect(openPoint).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('disables starting the vote when nobody is present or represented', () => {
    const { h } = setup({ canStartVote: true, noParticipants: true });
    expect((h.el.querySelector('.actions app-btn button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers to view and close a vote in progress without starting it again', () => {
    const { h } = setup({ statusLabel: 'En votación', canCloseVote: true });
    expect(labels(h)).toEqual(['Cerrar votación', 'Ver votación', 'Comentarios']);
    const closeVote = vi.fn();
    h.component.closeVote.subscribe(closeVote);
    (h.el.querySelector('.actions app-btn button') as HTMLButtonElement).click();
    expect(closeVote).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('hides "Cerrar votación" when the vote cannot be closed (meeting no longer convened)', () => {
    const { h } = setup({ statusLabel: 'En votación', canCloseVote: false });
    expect(h.el.textContent).not.toContain('Cerrar votación');
  });

  it('only offers to view a finished vote, never to start it again', () => {
    const { h, button } = setup({ statusLabel: 'Completado', voteClosed: true });
    expect(labels(h)).toEqual(['Ver votación', 'Comentarios']);
    expect(button.disabled).toBe(false);
    const openPoint = vi.fn();
    h.component.openPoint.subscribe(openPoint);
    button.click();
    expect(openPoint).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });
});

describe('MeetingAgendaTabComponent points without a vote and comments', () => {
  const buttons = (h: ReturnType<typeof setup>['h']) =>
    Array.from(h.el.querySelectorAll('.actions app-btn button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());

  it('never offers to start a vote on a point without one; it offers to mark it as treated', () => {
    const { h } = setup({ votable: false, canMarkTreated: true });
    expect(buttons(h).some((label) => label?.includes('Iniciar votación'))).toBe(false);
    expect(buttons(h)[0]).toContain('Marcar como tratado');
    const markTreated = vi.fn();
    h.component.markTreated.subscribe(markTreated);
    (h.el.querySelector('.actions app-btn button') as HTMLButtonElement).click();
    expect(markTreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('offers nothing to treat once the point is treated or the meeting is closed, only the comments button', () => {
    const { h } = setup({ votable: false, canMarkTreated: false });
    expect(buttons(h)).toEqual(['Comentarios']);
  });

  it('offers "Quitar marca" on a treated point instead of marking it again, and emits the row', () => {
    const { h } = setup({ votable: false, canUnmarkTreated: true });
    expect(buttons(h)).toEqual(['Quitar marca', 'Comentarios']);
    const unmarkTreated = vi.fn();
    h.component.unmarkTreated.subscribe(unmarkTreated);
    (h.el.querySelector('.actions app-btn button') as HTMLButtonElement).click();
    expect(unmarkTreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('shows a Comentarios button on every point (with and without a vote) that emits the row', () => {
    const { h } = setup({ votable: true, canStartVote: true });
    expect(buttons(h)).toEqual(['Iniciar votación', 'Ver votación', 'Comentarios']);
    const editComments = vi.fn();
    h.component.editComments.subscribe(editComments);
    (h.el.querySelectorAll('.actions app-btn button')[2] as HTMLButtonElement).click();
    expect(editComments).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));
  });

  it('shows the existing comments in the detail and flags them on the button', () => {
    const { h } = setup({ comments: 'Se aprueba con una reserva.' });
    expect(h.el.querySelector('.detail__comments')?.textContent).toContain('Se aprueba con una reserva.');
    expect(buttons(h).at(-1)).toContain('Comentarios (1)');
  });

  it('disables the comments button when the meeting is cancelled or the acta is signed', () => {
    const { h } = setup({ canComment: false });
    const last = Array.from(h.el.querySelectorAll('.actions app-btn button')).at(-1) as HTMLButtonElement;
    expect(last.disabled).toBe(true);
  });
});
