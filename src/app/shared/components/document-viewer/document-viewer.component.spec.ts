import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { settle } from '../../../core/testing/component-harness';
import { DocumentViewerComponent, type BlobLoader } from './document-viewer.component';

@Component({
  standalone: true,
  imports: [DocumentViewerComponent],
  template: `@if (shown()) { <app-document-viewer [loader]="loader()" [mimeType]="mime()" [title]="title()"></app-document-viewer> }`,
})
class HostComponent {
  readonly shown = signal(true);
  readonly loader = signal<BlobLoader>(() => Promise.resolve(new Blob(['%PDF-'])));
  readonly mime = signal<string | null>('application/pdf');
  readonly title = signal('Acta 2026');
}

describe('DocumentViewerComponent', () => {
  let created: string[];
  let revoked: string[];

  function mount() {
    const fixture = TestBed.configureTestingModule({ imports: [HostComponent] }).createComponent(HostComponent);
    return fixture;
  }

  async function render(fixture: ReturnType<typeof mount>) {
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  beforeEach(() => {
    created = [];
    revoked = [];
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:http://localhost/${++n}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders a PDF in an iframe from a blob: URL and asks the loader once', async () => {
    const fixture = mount();
    const loader = vi.fn(() => Promise.resolve(new Blob(['%PDF-'], { type: 'application/octet-stream' })));
    fixture.componentInstance.loader.set(loader);
    await render(fixture);
    const frame = fixture.nativeElement.querySelector('iframe') as HTMLIFrameElement;
    expect(loader).toHaveBeenCalledTimes(1);
    expect(frame.getAttribute('src')).toBe('blob:http://localhost/1');
    expect(frame.title).toBe('Acta 2026');
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
  });

  it('renders PNG, JPEG and WebP as an image', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
      TestBed.resetTestingModule();
      const fixture = mount();
      fixture.componentInstance.mime.set(mime);
      fixture.componentInstance.loader.set(() => Promise.resolve(new Blob(['x'])));
      await render(fixture);
      const img = fixture.nativeElement.querySelector('img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toMatch(new RegExp(`^data:${mime};base64,`));
      expect(img.alt).toBe('Acta 2026');
    }
  });

  it('never renders other formats inline (SVG, HTML, XML, text) and does not fetch them', async () => {
    for (const mime of ['image/svg+xml', 'text/html', 'application/xml', 'text/plain', null]) {
      TestBed.resetTestingModule();
      const fixture = mount();
      const loader = vi.fn(() => Promise.resolve(new Blob(['<svg/>'])));
      fixture.componentInstance.mime.set(mime);
      fixture.componentInstance.loader.set(loader);
      await render(fixture);
      expect(fixture.nativeElement.querySelector('iframe, img, object, embed')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Vista previa no disponible');
      expect(loader).not.toHaveBeenCalled();
    }
  });

  it('shows an error when the file cannot be loaded', async () => {
    const fixture = mount();
    fixture.componentInstance.loader.set(() => Promise.reject(new Error('404')));
    await render(fixture);
    expect(fixture.nativeElement.querySelector('[role=alert]')?.textContent).toContain('No se pudo abrir el documento.');
  });

  it('revokes the object URL when the input changes and on destroy', async () => {
    const fixture = mount();
    await render(fixture);
    expect(created).toEqual(['blob:http://localhost/1']);

    fixture.componentInstance.loader.set(() => Promise.resolve(new Blob(['%PDF-2'])));
    await render(fixture);
    expect(revoked).toEqual(['blob:http://localhost/1']);
    expect(fixture.nativeElement.querySelector('iframe').getAttribute('src')).toBe('blob:http://localhost/2');

    fixture.componentInstance.shown.set(false);
    fixture.detectChanges();
    expect(revoked).toEqual(['blob:http://localhost/1', 'blob:http://localhost/2']);
  });
});
