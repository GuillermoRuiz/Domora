import { TestBed } from '@angular/core/testing';
import { AttachmentGalleryComponent, type GalleryAttachment } from './attachment-gallery.component';

const PHOTO: GalleryAttachment = { id: 'a1', fileName: 'gotera.jpg', mimeType: 'image/jpeg', size: 2048 };
const PDF: GalleryAttachment = { id: 'a2', fileName: 'presupuesto.pdf', mimeType: 'application/pdf', size: 4096 };

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('AttachmentGalleryComponent', () => {
  let create: ReturnType<typeof vi.fn>;
  let revoke: ReturnType<typeof vi.fn>;
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

  beforeEach(() => {
    let n = 0;
    create = vi.fn(() => `blob:thumb-${++n}`);
    revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
  });

  afterEach(() => Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke }));

  function setup(inputs: { attachments?: GalleryAttachment[]; loader?: ((a: GalleryAttachment) => Promise<Blob>) | null; canAdd?: boolean } = {}) {
    TestBed.configureTestingModule({ imports: [AttachmentGalleryComponent] });
    const fixture = TestBed.createComponent(AttachmentGalleryComponent);
    fixture.componentRef.setInput('attachments', inputs.attachments ?? [PHOTO, PDF]);
    if (inputs.loader !== undefined) fixture.componentRef.setInput('loader', inputs.loader);
    if (inputs.canAdd !== undefined) fixture.componentRef.setInput('canAdd', inputs.canAdd);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, component: fixture.componentInstance };
  }

  it('loads images through the loader as object URLs and shows PDFs as a file tile', async () => {
    const loader = vi.fn(async () => new Blob(['x']));
    const { fixture, el } = setup({ loader });
    await settle();
    fixture.detectChanges();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(loader).toHaveBeenCalledWith(PHOTO);
    expect((create.mock.calls[0][0] as Blob).type).toBe('image/jpeg');
    expect(el.querySelector<HTMLImageElement>('[data-attachment="a1"] img')?.getAttribute('src')).toBe('blob:thumb-1');
    expect(el.querySelector('[data-attachment="a2"] img')).toBeNull();
    expect(el.querySelector('[data-attachment="a2"]')?.textContent).toContain('presupuesto.pdf');
  });

  it('revokes the object URLs when destroyed', async () => {
    const { fixture } = setup({ loader: async () => new Blob(['x']) });
    await settle();
    fixture.destroy();
    expect(revoke).toHaveBeenCalledWith('blob:thumb-1');
  });

  it('clicking an attachment asks to download it', () => {
    const { el, component } = setup();
    const emitted: GalleryAttachment[] = [];
    component.download.subscribe((a) => emitted.push(a));
    el.querySelector<HTMLButtonElement>('[data-attachment="a2"]')?.click();
    expect(emitted).toEqual([PDF]);
  });

  it('with canAdd offers the drop tile with its hint and emits the chosen files; without it, no tile', () => {
    expect(setup().el.querySelector('[data-add-files]')).toBeNull();
    TestBed.resetTestingModule();
    const { el, component } = setup({ canAdd: true });
    const tile = el.querySelector('[data-add-files]');
    expect(tile?.textContent).toContain('Añadir archivos');
    expect(tile?.textContent).toContain('JPG, PNG o PDF (máx. 10 MB)');
    const input = el.querySelector<HTMLInputElement>('[data-add-files] input[type=file]')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/*,application/pdf');
    const emitted: File[][] = [];
    component.filesSelected.subscribe((files) => emitted.push(files));
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([[file]]);
  });
});
