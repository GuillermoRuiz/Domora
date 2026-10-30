import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { LibraryDocument, LibraryFolder, LibraryListing } from '../../../core/document-library.service';
import type { OwnerProperty } from '../../../core/models';
import { LibraryTabComponent } from './library-tab.component';
import { LibraryUploadDialogComponent } from './library-upload-dialog.component';

const LIB = `${API}/estates/e1/library`;

function folder(overrides: Partial<LibraryFolder> = {}): LibraryFolder {
  return {
    id: 'f-legal', parentId: null, name: 'Documentación legal', systemKey: 'legal',
    visibility: null, effectiveVisibility: 'MANAGER', documentCount: 1, ownerDocumentCount: 0, ...overrides,
  };
}

function doc(overrides: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    id: 'd1', title: 'Estatutos.pdf', type: 'Estatutos', date: '2026-01-10', size: '1,2 MB', sizeBytes: 1_200_000,
    mimeType: 'application/pdf', folderId: null, source: 'upload', description: null, targetPropertyId: null,
    createdAt: '2026-01-10T10:00:00Z', updatedAt: '2026-01-12T10:00:00Z',
    visibility: null, effectiveVisibility: 'MANAGER', visibilityReviewPending: false, deletedAt: null, ...overrides,
  };
}

function listing(overrides: Partial<LibraryListing> = {}): LibraryListing {
  return {
    folders: [
      folder(),
      folder({ id: 'f-actas', name: 'Actas y juntas', systemKey: 'actas', visibility: 'OWNERS', effectiveVisibility: 'OWNERS', documentCount: 2, ownerDocumentCount: 2 }),
      folder({ id: 'f-sub', parentId: 'f-actas', name: '2026', systemKey: null, effectiveVisibility: 'OWNERS', documentCount: 1, ownerDocumentCount: 1 }),
    ],
    rootDocumentCount: 2, rootOwnerDocumentCount: 1,
    documents: [
      doc(),
      doc({ id: 'd2', title: 'Plano.png', mimeType: 'image/png', visibility: 'OWNERS', effectiveVisibility: 'OWNERS' }),
    ],
    pendingReview: 0, inTrash: 0, ...overrides,
  };
}

const PROPERTIES = [{ id: 'p1', floor: '2', door: 'B', staircase: null, ref: '2B' }] as unknown as OwnerProperty[];

describe('LibraryTabComponent', () => {
  let h: ComponentHarness<LibraryTabComponent>;

  async function render(first: LibraryListing = listing()): Promise<void> {
    h = setupComponent(LibraryTabComponent);
    h.fixture.componentRef.setInput('estateId', 'e1');
    h.fixture.componentRef.setInput('properties', PROPERTIES);
    h.fixture.componentRef.setInput('titularByProperty', { p1: 'Ana Pérez' });
    h.fixture.detectChanges();
    h.http.expectOne(`${LIB}?folderId=root`).flush(first);
    await stable();
  }

  async function stable(): Promise<void> {
    await settle();
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  }

  const text = () => h.el.textContent!.replace(/\s+/g, ' ');
  const tree = () => Array.from(h.el.querySelectorAll('.tree__item'))
    .map(b => [b.querySelector('.tree__name')!.textContent, b.querySelector('.tree__count')?.textContent].filter(Boolean).join(' ').trim());
  const rows = () => Array.from(h.el.querySelectorAll<HTMLTableRowElement>('tbody tr'));
  const button = (label: string, root: ParentNode = h.el) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent!.replace(/\s+/g, ' ').trim() === label)!;

  afterEach(() => h.http.verify());

  it('lists the root folders and documents with who sees each one', async () => {
    await render();

    expect(tree()).toEqual(['Todos los documentos 2', 'Documentación legal 1', 'Actas y juntas 2', '2026 1', 'Pendientes de revisar', 'Papelera']);
    expect(rows().map(r => r.querySelector('.name')!.textContent!.trim())).toEqual(['Documentación legal', 'Actas y juntas', 'Estatutos.pdf', 'Plano.png']);
    expect(rows()[2].textContent).toContain('Solo gestora');
    expect(rows()[3].textContent).toContain('Todos los propietarios');
    expect(rows()[3].textContent).toContain('Visibilidad propia');
    expect(rows()[2].textContent).not.toContain('Visibilidad propia');
  });

  it('opens a folder and shows its path and inherited visibility', async () => {
    await render();

    (h.el.querySelectorAll<HTMLButtonElement>('.tree__item')[3]).click();
    h.fixture.detectChanges();
    h.http.expectOne(`${LIB}?folderId=f-sub`).flush(listing({ documents: [doc({ id: 'd9', folderId: 'f-sub', effectiveVisibility: 'OWNERS' })] }));
    await stable();

    expect(Array.from(h.el.querySelectorAll('.crumbs li')).map(li => li.textContent!.trim())).toEqual(['Documentos', 'Actas y juntas', '2026']);
    expect(h.el.querySelector('.panel__meta')!.textContent!.replace(/\s+/g, ' ')).toContain('Visible para: Todos los propietarios (heredado)');
  });

  it('flags migrated documents pending review and keeps them manager-only on request', async () => {
    await render(listing({ pendingReview: 3 }));

    expect(text()).toContain('3 documentos dejaron de ser visibles para los propietarios');
    button('Revisar').click();
    h.fixture.detectChanges();
    const pending = doc({ id: 'd5', visibilityReviewPending: true });
    h.http.expectOne(`${LIB}?view=review`).flush(listing({ folders: [], documents: [pending], pendingReview: 1 }));
    await stable();

    button('Solo gestora').click();
    await settle();
    const review = h.http.expectOne(`${LIB}/review`);
    expect(review.request.body).toEqual({ documentIds: ['d5'], all: false });
    review.flush({ reviewed: 1 });
    await settle();
    h.http.expectOne(`${LIB}?view=review`).flush(listing({ folders: [], documents: [], pendingReview: 0 }));
    await settle();
    h.http.expectOne(`${LIB}?folderId=root`).flush(listing());
    await stable();
  });

  it('«Ver como propietario» hides what owners cannot see', async () => {
    await render();

    button('Ver como propietario').click();
    h.fixture.detectChanges();

    expect(rows().map(r => r.querySelector('.name')!.textContent!.trim())).toEqual(['Actas y juntas', 'Plano.png']);
    expect(tree()).toEqual(['Todos los documentos 1', 'Actas y juntas 2', '2026 1']);
    expect(text()).toContain('Vista de propietario.');
  });

  it('filters the current view by type, audience and origin, hiding folders while filtering', async () => {
    await render(listing({ documents: [
      doc(),
      doc({ id: 'd2', title: 'Plano.png', type: 'Plano', effectiveVisibility: 'OWNERS', visibility: 'OWNERS' }),
      doc({ id: 'a1', title: 'Acta — Junta', type: 'Acta', source: 'generated', effectiveVisibility: 'OWNERS' }),
    ] }));
    const names = () => rows().map(r => r.querySelector('.name')?.textContent!.trim());
    const pick = async (id: string, value: string) => {
      const select = h.el.querySelector<HTMLSelectElement>(id)!;
      select.value = value;
      select.dispatchEvent(new Event('change'));
      await stable();
    };
    await stable();

    await pick('#library-filter-audience', 'OWNERS');
    expect(names()).toEqual(['Plano.png', 'Acta — Junta']);
    await pick('#library-filter-source', 'generated');
    expect(names()).toEqual(['Acta — Junta']);
    await pick('#library-filter-type', 'Plano');
    expect(text()).toContain('Ningún documento coincide con los filtros.');

    button('Quitar filtros').click();
    await stable();
    expect(names()).toEqual(['Documentación legal', 'Actas y juntas', 'Estatutos.pdf', 'Plano.png', 'Acta — Junta']);
  });

  it('searches the whole estate after a short pause', async () => {
    await render();

    h.component.onSearch('estatutos');
    await new Promise(resolve => setTimeout(resolve, 300));
    h.http.expectOne(`${LIB}?q=estatutos`).flush(listing({ documents: [doc()] }));
    await stable();

    expect(h.el.querySelector('.panel__title h3')!.textContent).toContain('Resultados de «estatutos»');
  });

  it('a failed download says why, with the server message', async () => {
    await render();

    (h.el.querySelectorAll<HTMLButtonElement>('tbody tr .action-btn')[2]).click();
    h.fixture.detectChanges();
    button('Descargar').click();
    h.http.expectOne(`${API}/documents/d1/file`).flush(
      new Blob([JSON.stringify({ statusCode: 404, message: 'El fichero de este documento no está disponible.' })], { type: 'application/json' }),
      { status: 404, statusText: 'Not Found' },
    );
    await stable();

    expect(h.el.querySelector('.toast')?.textContent).toContain('El fichero de este documento no está disponible.');
  });

  it('the preview dialog shows a PDF through the shared viewer, asking for it as a view', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/pdf');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await render();

    rows()[2].querySelector<HTMLButtonElement>('.name')!.click();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/documents/d1/file?purpose=view`).flush(new Blob(['%PDF-']));
    await stable();

    const dialog = h.el.querySelector('app-library-preview-dialog')!;
    expect(dialog.querySelector('#lp-title')!.textContent).toBe('Estatutos.pdf');
    expect(dialog.querySelector('app-document-viewer iframe')!.getAttribute('src')).toBe('blob:http://localhost/pdf');

    button('Cerrar', dialog).click();
    h.fixture.detectChanges();
    expect(h.el.querySelector('app-library-preview-dialog')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/pdf');
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it('does not offer renaming or trashing a generated acta', async () => {
    await render(listing({ documents: [doc({ id: 'a1', title: 'Acta — Junta ordinaria', source: 'generated' })] }));

    (h.el.querySelector<HTMLButtonElement>('tbody tr:last-child .action-btn')!).click();
    h.fixture.detectChanges();

    const items = Array.from(h.el.querySelectorAll('.row-menu button')).map(b => b.textContent!.trim());
    expect(items).toEqual(['Vista previa', 'Descargar', 'Quién lo ve', 'Mover a…']);
  });

  it('opening a document to owners warns about personal data and saves the new level', async () => {
    await render();

    (h.el.querySelectorAll<HTMLButtonElement>('tbody tr .action-btn')[2]).click();
    h.fixture.detectChanges();
    button('Quién lo ve').click();
    h.fixture.detectChanges();

    const dialog = h.el.querySelector('app-library-visibility-dialog')!;
    expect(dialog.textContent).not.toContain('datos personales');
    const owners = Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .find(r => r.closest('label')!.textContent!.includes('Todos los propietarios'))!;
    owners.click();
    h.fixture.detectChanges();
    expect(dialog.textContent).toContain('datos personales de otros vecinos');

    button('Abrir a propietarios', dialog).click();
    await settle();
    const patch = h.http.expectOne(`${LIB}/documents/d1`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ visibility: 'OWNERS', targetPropertyId: null });
    patch.flush({});
    await settle();
    h.http.expectOne(`${LIB}?folderId=root`).flush(listing());
    await stable();
    expect(h.el.querySelector('app-library-visibility-dialog')).toBeNull();
  });

  it('closes a dialog with Escape wherever the focus is', async () => {
    await render();

    button('Nueva carpeta').click();
    await stable();
    expect(h.el.querySelector('app-library-name-dialog')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    h.fixture.detectChanges();

    expect(h.el.querySelector('app-library-name-dialog')).toBeNull();
  });

  it('creates a folder inside the current one', async () => {
    await render();

    button('Nueva carpeta').click();
    await stable();
    const input = h.el.querySelector<HTMLInputElement>('#ln-name')!;
    input.value = 'Ascensor';
    input.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    button('Crear carpeta').click();
    await settle();

    const create = h.http.expectOne(`${LIB}/folders`);
    expect(create.request.body).toEqual({ name: 'Ascensor', parentId: undefined });
    create.flush({ id: 'f-new' });
    await settle();
    h.http.expectOne(`${LIB}?folderId=root`).flush(listing());
    await stable();
  });

  it('shows a duplicate-name error inside the folder dialog', async () => {
    await render();

    button('Nueva carpeta').click();
    await stable();
    const input = h.el.querySelector<HTMLInputElement>('#ln-name')!;
    input.value = 'Seguros';
    input.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    button('Crear carpeta').click();
    await settle();
    h.http.expectOne(`${LIB}/folders`).flush({ message: 'Ya existe una carpeta con ese nombre aquí.' }, { status: 409, statusText: 'Conflict' });
    await stable();

    expect(h.el.querySelector('app-library-name-dialog [role="alert"]')!.textContent).toContain('Ya existe una carpeta con ese nombre aquí.');
  });
});

describe('LibraryUploadDialogComponent', () => {
  it('rejects files over 10 MB and uploads the rest into the chosen folder, inheriting its visibility', async () => {
    const h = setupComponent(LibraryUploadDialogComponent);
    h.fixture.componentRef.setInput('estateId', 'e1');
    h.fixture.componentRef.setInput('folders', listing().folders);
    h.fixture.componentRef.setInput('initialFolderId', 'f-actas');
    let uploaded = 0;
    h.component.uploaded.subscribe(n => (uploaded = n));
    h.fixture.detectChanges();

    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' });
    const ok = new File(['%PDF-1.4'], 'acta.pdf', { type: 'application/pdf' });
    const picker = h.el.querySelector<HTMLInputElement>('#lu-files')!;
    Object.defineProperty(picker, 'files', { value: [big, ok] });
    picker.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Supera los 10 MB');
    expect(h.el.textContent).toContain('Igual que la carpeta (Todos los propietarios)');
    expect(h.el.textContent).toContain('recibirán un aviso');

    void h.component.upload();
    await settle();
    const req = h.http.expectOne(`${API}/estates/e1/documents/upload`);
    const form = req.request.body as FormData;
    expect(form.get('folderId')).toBe('f-actas');
    expect(form.get('visibility')).toBeNull();
    expect((form.get('file') as File).name).toBe('acta.pdf');
    req.flush({ id: 'd-new' });
    await settle();

    h.http.verify();
    expect(uploaded).toBe(1);
  });
});
