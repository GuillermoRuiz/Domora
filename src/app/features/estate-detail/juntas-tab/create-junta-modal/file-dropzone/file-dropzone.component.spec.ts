import { TestBed } from '@angular/core/testing';
import { FileDropzoneComponent, formatFileSize } from './file-dropzone.component';

function file(name: string, type: string, size = 100): File {
  const f = new File(['x'], name, { type, lastModified: 1 });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function setup(files: File[] = []) {
  TestBed.configureTestingModule({ imports: [FileDropzoneComponent] });
  const fixture = TestBed.createComponent(FileDropzoneComponent);
  fixture.componentRef.setInput('files', files);
  fixture.detectChanges();
  const emitted: File[][] = [];
  fixture.componentInstance.filesChange.subscribe((f) => emitted.push(f));
  const pick = (list: File[]) =>
    fixture.componentInstance.onSelect({ target: { files: list, value: 'x' } } as unknown as Event);
  return { fixture, component: fixture.componentInstance, emitted, pick };
}

describe('FileDropzoneComponent', () => {
  it('accepts the types and sizes the backend accepts', () => {
    const { emitted, pick } = setup();
    pick([file('convocatoria.pdf', 'application/pdf', 2_400_000), file('plano.png', 'image/png')]);
    expect(emitted.at(-1)?.map((f) => f.name)).toEqual(['convocatoria.pdf', 'plano.png']);
  });

  it('rejects unsupported types, empty files and files over 10 MB, explaining why', () => {
    const { component, emitted, pick } = setup();
    pick([
      file('virus.exe', 'application/x-msdownload'),
      file('vacio.pdf', 'application/pdf', 0),
      file('enorme.pdf', 'application/pdf', 10 * 1024 * 1024 + 1),
    ]);
    expect(emitted.length).toBe(0);
    expect(component.rejected()).toEqual([
      '«virus.exe»: tipo de archivo no admitido.',
      '«vacio.pdf»: el archivo está vacío.',
      '«enorme.pdf»: supera el máximo de 10 MB.',
    ]);
  });

  it('keeps valid files when others in the same selection are rejected', () => {
    const { component, emitted, pick } = setup();
    pick([file('ok.pdf', 'application/pdf'), file('malo.exe', 'application/x-msdownload')]);
    expect(emitted.at(-1)?.map((f) => f.name)).toEqual(['ok.pdf']);
    expect(component.rejected().length).toBe(1);
  });

  it('does not add the same file twice', () => {
    const existing = file('a.pdf', 'application/pdf');
    const { emitted, pick } = setup([existing]);
    pick([file('a.pdf', 'application/pdf')]);
    expect(emitted.length).toBe(0);
  });

  it('removes a file before the junta is created', () => {
    const a = file('a.pdf', 'application/pdf');
    const b = file('b.pdf', 'application/pdf');
    const { component, emitted } = setup([a, b]);
    component.remove(0);
    expect(emitted.at(-1)).toEqual([b]);
  });

  it('lists the selected files with their size', () => {
    const { fixture } = setup([file('Convocatoria.pdf', 'application/pdf', 2_516_582)]);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Convocatoria.pdf');
    expect(text).toContain('2,4 MB');
  });

  it('ignores drops while disabled', () => {
    const { fixture, component, emitted } = setup();
    fixture.componentRef.setInput('disabled', true);
    component.onDrop({
      preventDefault: () => undefined,
      dataTransfer: { files: [file('a.pdf', 'application/pdf')] },
    } as unknown as DragEvent);
    expect(emitted.length).toBe(0);
  });

  it('formats sizes in Spanish', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(2_516_582)).toBe('2,4 MB');
  });
});
