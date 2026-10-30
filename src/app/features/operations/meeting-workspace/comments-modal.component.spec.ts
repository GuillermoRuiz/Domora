import { setupComponent } from '../../../core/testing/component-harness';
import type { AgendaRow } from './meeting-workspace.model';
import { MeetingCommentsModalComponent } from './comments-modal.component';

const row = (comments = ''): AgendaRow => ({ id: 'a1', number: '02', title: 'Presupuesto', comments }) as AgendaRow;

function setup(comments = '') {
  const h = setupComponent(MeetingCommentsModalComponent);
  h.fixture.componentRef.setInput('row', row(comments));
  h.fixture.detectChanges();
  return h;
}
const root = (h: ReturnType<typeof setup>) => h.fixture.nativeElement as HTMLElement;
const save = (h: ReturnType<typeof setup>) => Array.from(root(h).querySelectorAll('.modal__footer button')).pop() as HTMLButtonElement;

describe('MeetingCommentsModalComponent', () => {
  it('names the point, says the text goes to the acta and starts with the current comments', () => {
    const h = setup('Nota previa');
    expect(root(h).textContent).toContain('02 · Presupuesto');
    expect(root(h).textContent).toContain('Aparecerá en el acta');
    expect(h.component.text()).toBe('Nota previa');
  });

  it('cannot save until the text changes', () => {
    const h = setup('Nota previa');
    expect(save(h).disabled).toBe(true);
    h.component.text.set('Nota previa y más');
    h.fixture.detectChanges();
    expect(save(h).disabled).toBe(false);
  });

  it('emits the text typed, and an empty text to delete the comments', () => {
    const h = setup('Nota previa');
    const saved = vi.fn();
    h.component.save.subscribe(saved);
    h.component.text.set('Se aprueba con una reserva.');
    h.component.submit();
    expect(saved).toHaveBeenCalledWith('Se aprueba con una reserva.');
    h.component.text.set('');
    h.component.submit();
    expect(saved).toHaveBeenLastCalledWith('');
  });

  it('does not save or close while saving, and shows the API error', () => {
    const h = setup();
    const saved = vi.fn();
    const closed = vi.fn();
    h.component.save.subscribe(saved);
    h.component.closed.subscribe(closed);
    h.component.text.set('Algo');
    h.fixture.componentRef.setInput('busy', true);
    h.fixture.componentRef.setInput('error', 'El acta ya está firmada.');
    h.fixture.detectChanges();
    h.component.submit();
    h.component.close();
    expect(saved).not.toHaveBeenCalled();
    expect(closed).not.toHaveBeenCalled();
    expect(root(h).textContent).toContain('El acta ya está firmada.');
  });

  it('limits the text to 2000 characters', () => {
    const h = setup();
    expect(root(h).querySelector('textarea')?.getAttribute('maxlength')).toBe('2000');
    expect(root(h).textContent).toContain('0 / 2000');
  });
});
