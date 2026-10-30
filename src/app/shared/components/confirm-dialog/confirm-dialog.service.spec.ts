import { TestBed } from '@angular/core/testing';
import { ConfirmDialogService } from './confirm-dialog.service';

const dialog = () => document.body.querySelector('app-confirm-dialog') as HTMLElement | null;
const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('app-confirm-dialog button'));
const options = { title: 'Cancelar junta', message: 'Se cancelará la junta.', confirmLabel: 'Cancelar junta', cancelLabel: 'Volver', tone: 'danger' as const };

describe('ConfirmDialogService', () => {
  let service: ConfirmDialogService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ConfirmDialogService);
  });

  afterEach(() => dialog()?.remove());

  it('shows an in-app dialog with the title, message and the given labels', () => {
    void service.ask(options);
    expect(dialog()?.textContent).toContain('Cancelar junta');
    expect(dialog()?.textContent).toContain('Se cancelará la junta.');
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Volver', 'Cancelar junta']);
    expect(dialog()?.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it('uses default labels when none are given', () => {
    void service.ask({ title: 'Enviar', message: 'Seguro' });
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Cancelar', 'Confirmar']);
  });

  it('resolves true and closes when the user confirms', async () => {
    const answer = service.ask(options);
    buttons()[1].click();
    await expect(answer).resolves.toBe(true);
    expect(dialog()).toBeNull();
  });

  it('resolves false and closes when the user cancels', async () => {
    const answer = service.ask(options);
    buttons()[0].click();
    await expect(answer).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });

  it('resolves false with Escape and when clicking outside the dialog', async () => {
    const withEscape = service.ask(options);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(withEscape).resolves.toBe(false);

    const withBackdrop = service.ask(options);
    (document.body.querySelector('app-confirm-dialog .backdrop') as HTMLElement).click();
    await expect(withBackdrop).resolves.toBe(false);
    expect(dialog()).toBeNull();
  });

  it('keeps Escape from reaching handlers of the modal behind it', async () => {
    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    const answer = service.ask(options);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await answer;
    document.removeEventListener('keydown', behind);
    expect(behind).not.toHaveBeenCalled();
  });
});
