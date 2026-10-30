import { setupComponent } from '../../../core/testing/component-harness';
import type { MeetingAttachment } from '../../../core/models';
import { MeetingAttachmentsComponent } from './meeting-attachments.component';

const attachments = [
  { id: 'a1', meetingId: 'm1', title: 'Convocatoria.pdf', mimeType: 'application/pdf', sizeBytes: 245 * 1024, uploadedAt: '2027-01-10T12:00:00Z' },
  { id: 'a2', meetingId: 'm1', title: 'Presupuesto 2027.xlsx', mimeType: null, sizeBytes: null, uploadedAt: '2027-01-08T12:00:00Z' },
] as MeetingAttachment[];

function setup(items: MeetingAttachment[] = attachments, busy = false) {
  const h = setupComponent(MeetingAttachmentsComponent);
  h.fixture.componentRef.setInput('attachments', items);
  h.fixture.componentRef.setInput('busy', busy);
  h.fixture.detectChanges();
  return h;
}

describe('MeetingAttachmentsComponent', () => {
  it('lists each document with its type, size and date', () => {
    const h = setup();
    const rows = h.el.querySelectorAll('.doc');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Convocatoria.pdf');
    expect(rows[0].textContent).toContain('PDF • 245 KB • 10 ene 2027');
    // sin tamaño conocido (adjunto antiguo) no se inventa uno
    expect(rows[1].querySelector('.doc__meta')?.textContent?.trim()).toBe('Excel • 8 ene 2027');
  });

  it('shows an empty state without documents', () => {
    const h = setup([]);
    expect(h.el.querySelector('.docs__empty')?.textContent).toContain('Todavía no hay documentos adjuntos');
  });

  it('emits the chosen files when attaching', () => {
    const h = setup();
    const upload = vi.fn();
    h.component.upload.subscribe(upload);
    const file = new File(['x'], 'acta.pdf', { type: 'application/pdf' });
    const input = h.el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(upload).toHaveBeenCalledWith([file]);
  });

  it('disables the attach button while busy', () => {
    const h = setup(attachments, true);
    expect((h.el.querySelector('.attach-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the row menu to download or delete, and closes it afterwards', () => {
    const h = setup();
    const download = vi.fn();
    const remove = vi.fn();
    h.component.download.subscribe(download);
    h.component.remove.subscribe(remove);
    const trigger = () => h.el.querySelector('.doc__more') as HTMLButtonElement;

    trigger().click();
    h.fixture.detectChanges();
    const items = Array.from(h.el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Descargar', 'Eliminar']);
    items[0].click();
    expect(download).toHaveBeenCalledWith(attachments[0]);
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="menu"]')).toBeNull();

    trigger().click();
    h.fixture.detectChanges();
    (h.el.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click();
    expect(remove).toHaveBeenCalledWith(attachments[0]);
  });

  it('closes the menu with a click outside', () => {
    const h = setup();
    (h.el.querySelector('.doc__more') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="menu"]')).not.toBeNull();
    document.body.click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="menu"]')).toBeNull();
  });
});
