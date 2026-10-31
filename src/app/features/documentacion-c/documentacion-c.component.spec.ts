import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import type { TestRequest } from '@angular/common/http/testing';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { OwnerScopeService, type ScopeProperty } from '../../core/owner-scope.service';
import { DocumentacionCComponent } from './documentacion-c.component';
import { COUNTS, documentList, ownerDocument } from './testing/owner-document-fixtures';
import { fakeOwnerScope } from '../../core/testing/fake-owner-scope';

const P1: ScopeProperty = { id: 'p1', nickname: '3A', addressFull: 'Calle Colón 24', estateId: 'e1', estateName: 'Colón 24', isLinked: true };
const P2: ScopeProperty = { id: 'p2', nickname: '1A', addressFull: 'Calle Cuba 18', estateId: 'e2', estateName: 'Cuba 18', isLinked: true };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
/** «label value» of a detail meta row. */
const meta = (root: Element, key: string) => ['dt', 'dd'].map((tag) => text(root.querySelector(`[data-meta="${key}"] ${tag}`))).join(' ');


describe('DocumentacionCComponent', () => {
  let h: ComponentHarness<DocumentacionCComponent>;
  let params: BehaviorSubject<ParamMap>;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function mount(scope = fakeOwnerScope([P1, P2], { selectedId: 'p1' }), query: Record<string, string> = {}) {
    params = new BehaviorSubject(convertToParamMap(query));
    h = setupComponent(DocumentacionCComponent, {
      user: makeUser({ id: 'u1' }),
      providers: [
        { provide: OwnerScopeService, useValue: scope },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params.value }, queryParamMap: params } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.fixture.detectChanges();
    await settle();
    return scope;
  }

  const listRequest = (): TestRequest => h.http.expectOne((r) => r.url === `${API}/me/documents`);

  async function render() {
    await settle();
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
  }

  async function flushList(list = documentList()) {
    const req = listRequest();
    req.flush(list);
    await render();
    return req;
  }

  function click(selector: string, root: ParentNode = h.el) {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`not found: ${selector}`);
    el.click();
    h.fixture.detectChanges();
  }

  /** Opens the detail like the router would after `navigate`. */
  async function openDetail(id: string) {
    params.next(convertToParamMap({ doc: id }));
    await render();
  }

  afterEach(() => {
    h?.http.verify();
    vi.restoreAllMocks();
  });

  it('shows the header with the current scope, the scope selector and the honest search placeholder', async () => {
    const scope = await mount();
    await flushList();
    expect(scope.load).toHaveBeenCalled();
    expect(h.el.querySelector('app-topbar [slot=heading] app-community-scope-selector')).not.toBeNull();
    expect(text(h.el.querySelector('h1'))).toBe('Documentación');
    expect(text(h.el.querySelector('.docs__sub'))).toBe('Documentos de tu comunidad disponibles para su consulta y descarga.');
    expect(text(h.el.querySelector('[data-scope-chip]'))).toBe('Ámbito actual: Colón 24');
    const input = h.el.querySelector<HTMLInputElement>('[data-search]')!;
    expect(input.placeholder).toBe('Buscar documentos por nombre, descripción o categoría…');
    expect(input.labels?.[0] ?? input.getAttribute('aria-label')).toBeTruthy();
  });

  it('the list follows the scope: a property sends propertyId, «Todas» does not and shows the estate under each title', async () => {
    const scope = await mount();
    const first = listRequest();
    expect(first.request.params.get('propertyId')).toBe('p1');
    expect(first.request.params.get('sort')).toBe('date_desc');
    first.flush(documentList());
    await render();
    expect(h.el.querySelector('[data-estate]')).toBeNull();

    scope.select(null);
    h.fixture.detectChanges();
    await settle();
    const all = listRequest();
    expect(all.request.params.has('propertyId')).toBe(false);
    all.flush(documentList([ownerDocument(), ownerDocument({ id: 'd2', estateId: 'e2', estateName: 'Cuba 18' })]));
    await render();
    expect(text(h.el.querySelector('[data-scope-chip]'))).toBe('Ámbito actual: Todas mis propiedades');
    expect(Array.from(h.el.querySelectorAll('[data-estate]')).map(text)).toEqual(['Colón 24', 'Cuba 18']);
  });

  it('the search is debounced and sent to the server as q', async () => {
    await mount();
    await flushList();
    const input = h.el.querySelector<HTMLInputElement>('[data-search]')!;
    input.value = 'seguro';
    input.dispatchEvent(new Event('input'));
    h.http.expectNone((r) => r.url === `${API}/me/documents`);
    await wait(350);
    h.fixture.detectChanges();
    await settle();
    expect(listRequest().request.params.get('q')).toBe('seguro');
  });

  it('the «Filtros» popover sends date range, file type and only new, counts them, clears them and closes on Escape', async () => {
    await mount();
    await flushList();
    click('[data-action="filters"]');
    const pop = h.el.querySelector('[data-filter-popover]')!;
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.querySelector('[data-filter="property"]')).toBeNull();
    expect(Array.from(pop.querySelectorAll('[data-filter="fileType"] option')).map(text)).toEqual(['Todos', 'PDF', 'Imagen', 'Hoja de cálculo', 'Documento', 'Otro']);

    const set = (sel: string, value: string, event = 'change') => {
      const el = pop.querySelector<HTMLInputElement | HTMLSelectElement>(sel)!;
      el.value = value;
      el.dispatchEvent(new Event(event));
    };
    set('[data-filter="from"]', '2026-01-01');
    set('[data-filter="to"]', '2026-06-30');
    set('[data-filter="fileType"]', 'spreadsheet');
    const onlyNew = pop.querySelector<HTMLInputElement>('[data-filter="onlyNew"]')!;
    onlyNew.checked = true;
    onlyNew.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    await settle();

    const reqs = h.http.match((r) => r.url === `${API}/me/documents`);
    const last = reqs[reqs.length - 1];
    expect(last.request.params.get('from')).toBe('2026-01-01');
    expect(last.request.params.get('to')).toBe('2026-06-30');
    expect(last.request.params.get('fileType')).toBe('spreadsheet');
    expect(last.request.params.get('onlyNew')).toBe('true');
    reqs.forEach((r) => r.flush(documentList()));
    await render();
    expect(text(h.el.querySelector('[data-filter-count]'))).toBe('4');

    click('[data-action="clear-filters"]');
    await settle();
    const cleared = listRequest();
    expect(['from', 'to', 'fileType', 'onlyNew'].some((k) => cleared.request.params.has(k))).toBe(false);
    cleared.flush(documentList());
    await render();
    expect(h.el.querySelector('[data-filter-count]')).toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-filter-popover]')).toBeNull();
  });

  it('?onlyNew=1 (the «Documentos nuevos» KPI) starts with the only-new filter on', async () => {
    await mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }), { onlyNew: '1' });
    const req = await flushList();
    expect(req.request.params.get('onlyNew')).toBe('true');
    expect(text(h.el.querySelector('[data-filter-count]'))).toBe('1');
  });

  it('without ?onlyNew the list starts unfiltered', async () => {
    await mount();
    const req = await flushList();
    expect(req.request.params.has('onlyNew')).toBe(false);
    expect(h.el.querySelector('[data-filter-count]')).toBeNull();
  });

  it('in «Todas» the popover offers the property, which is sent as propertyId', async () => {
    await mount(fakeOwnerScope([P1, P2], { selectedId: null }));
    await flushList();
    click('[data-action="filters"]');
    const select = h.el.querySelector<HTMLSelectElement>('[data-filter-popover] [data-filter="property"]')!;
    expect(Array.from(select.options).map(text)).toEqual(['Todas', '3A · Colón 24', '1A · Cuba 18']);
    select.value = 'p2';
    select.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    await settle();
    expect(listRequest().request.params.get('propertyId')).toBe('p2');
  });

  it('category chips show the counts, filter by category and the empty state names the category', async () => {
    await mount();
    await flushList();
    const chips = Array.from(h.el.querySelectorAll<HTMLButtonElement>('[data-category]'));
    expect(chips.map(text)).toEqual(['Todos 12', 'Actas 3', 'Económicos 4', 'Normativa 2', 'Seguros 1', 'Contratos 1', 'Otros 1']);
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');

    click('[data-category="seguros"]');
    await settle();
    const req = listRequest();
    expect(req.request.params.get('category')).toBe('seguros');
    req.flush(documentList([], COUNTS));
    await render();
    expect(h.el.querySelector('[data-category="seguros"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(text(h.el.querySelector('[data-list-empty]'))).toContain('No hay documentos de Seguros todavía');
  });

  it('the table shows icon, title, description, markers, category pill, es-ES date and size', async () => {
    await mount();
    await flushList(documentList([
      ownerDocument({ isNew: true, board: true }),
      ownerDocument({ id: 'd2', title: 'Presupuesto 2027', description: null, category: 'economicos', fileType: 'spreadsheet', date: '2026-03-05', size: '48 KB' }),
    ]));
    const [first, second] = Array.from(h.el.querySelectorAll('[data-doc]'));
    expect(first.querySelector('.doc-icon--pdf')).not.toBeNull();
    expect(text(first.querySelector('.doc-row__title'))).toBe('Acta junta ordinaria 2026');
    expect(text(first.querySelector('.doc-row__excerpt'))).toBe('Acta de la junta ordinaria de propietarios.');
    expect(text(first.querySelector('[data-new-pill]'))).toBe('Nuevo');
    expect(text(first.querySelector('[data-board-marker]'))).toBe('Junta');
    expect(first.querySelector('.cat-pill--blue')).not.toBeNull();
    expect(text(first.querySelector('td[data-col="fecha"]'))).toBe('12 oct 2026');
    expect(text(first.querySelector('td[data-col="tamano"]'))).toBe('2,4 MB');
    expect(second.querySelector('.doc-icon--spreadsheet')).not.toBeNull();
    expect(second.querySelector('.cat-pill--accent')).not.toBeNull();
    expect(second.querySelector('[data-new-pill]')).toBeNull();
    expect(second.querySelector('.doc-row__excerpt')).toBeNull();
    expect(text(second.querySelector('td[data-col="fecha"]'))).toBe('5 mar 2026');
  });

  it('column headers sort on the server', async () => {
    await mount();
    await flushList();
    const sortBy = async (key: string) => {
      click(`[data-sort="${key}"]`);
      await settle();
      const req = listRequest();
      const sort = req.request.params.get('sort');
      req.flush(documentList());
      await render();
      return sort;
    };
    expect(await sortBy('date')).toBe('date_asc');
    expect(await sortBy('date')).toBe('date_desc');
    expect(await sortBy('name')).toBe('name_asc');
    expect(h.el.querySelector('[data-sort="name"]')!.closest('th')!.getAttribute('aria-sort')).toBe('ascending');
    expect(await sortBy('size')).toBe('size_desc');
  });

  it('«Marcar todo como leído» posts the visible new ids and clears their pills', async () => {
    await mount();
    await flushList(documentList([ownerDocument({ isNew: true }), ownerDocument({ id: 'd2' }), ownerDocument({ id: 'd3', isNew: true })]));
    click('[data-action="mark-all-read"]');
    const req = h.http.expectOne(`${API}/me/documents/read`);
    expect(req.request.body).toEqual({ documentIds: ['d1', 'd3'] });
    req.flush({ marked: 2 });
    await render();
    expect(h.el.querySelector('[data-new-pill]')).toBeNull();
    expect(h.el.querySelector('[data-action="mark-all-read"]')).toBeNull();
  });

  it('«Marcar todo como leído» sends more than 200 new ids in batches the server accepts', async () => {
    await mount();
    const docs = Array.from({ length: 450 }, (_, i) => ownerDocument({ id: `d${i}`, isNew: true }));
    await flushList(documentList(docs));
    click('[data-action="mark-all-read"]');
    const sizes: number[] = [];
    for (let batch = 0; batch < 3; batch++) {
      await settle();
      const req = h.http.expectOne(`${API}/me/documents/read`);
      sizes.push(req.request.body.documentIds.length);
      req.flush({ marked: req.request.body.documentIds.length });
    }
    await render();
    expect(sizes).toEqual([200, 200, 50]);
    expect(h.el.querySelector('[data-new-pill]')).toBeNull();
    expect(h.el.querySelector('[data-page-notice]')).toBeNull();
  });

  it('«Marcar todo como leído» restores the pills it could not mark and says so', async () => {
    await mount();
    const docs = Array.from({ length: 250 }, (_, i) => ownerDocument({ id: `d${i}`, isNew: true }));
    await flushList(documentList(docs));
    click('[data-action="mark-all-read"]');
    await settle();
    h.http.expectOne(`${API}/me/documents/read`).flush({ marked: 200 });
    await settle();
    h.http.expectOne(`${API}/me/documents/read`).flush({ message: 'fallo' }, { status: 500, statusText: 'Server Error' });
    await render();
    expect(h.el.querySelectorAll('[data-new-pill]').length).toBe(50);
    expect(h.el.querySelector('[data-new-pill]')?.closest('[data-doc]')?.getAttribute('data-doc')).toBe('d200');
    expect(text(h.el.querySelector('[data-page-notice]'))).toBe('No se pudieron marcar todos los documentos como leídos. Inténtalo de nuevo.');
  });

  it('clicking a row syncs ?doc, opens the detail with its data, previews it as a view and marks it read', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/v');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    await mount();
    await flushList(documentList([ownerDocument({ isNew: true })]));
    click('[data-doc="d1"]');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { doc: 'd1' }, queryParamsHandling: 'merge' }));
    await openDetail('d1');

    const read = h.http.expectOne(`${API}/me/documents/read`);
    expect(read.request.body).toEqual({ documentIds: ['d1'] });
    read.flush({ marked: 1 });
    h.http.expectOne(`${API}/documents/d1/file?purpose=view`).flush(new Blob(['%PDF-']));
    await render();

    const detail = h.el.querySelector('[data-detail]')!;
    expect(text(detail.querySelector('[data-detail-title]'))).toBe('Acta junta ordinaria 2026');
    expect(text(detail.querySelector('[data-detail-type]'))).toBe('PDF · 2,4 MB');
    expect(detail.querySelector('.cat-pill--blue')).not.toBeNull();
    expect(meta(detail, 'fecha')).toBe('Fecha de publicación 12 oct 2026');
    expect(meta(detail, 'publicado')).toBe('Publicado por Administración de la comunidad');
    expect(meta(detail, 'descripcion')).toBe('Descripción Acta de la junta ordinaria de propietarios.');
    expect(detail.querySelector('app-document-viewer iframe')!.getAttribute('src')).toBe('blob:http://localhost/v');
    expect(h.el.querySelector('[data-doc="d1"]')!.classList).toContain('doc-row--selected');
    expect(h.el.querySelector('[data-new-pill]')).toBeNull();
  });

  it('a deep link opens the detail and closing it removes ?doc', async () => {
    await mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }), { doc: 'd2' });
    await flushList(documentList([ownerDocument(), ownerDocument({ id: 'd2', title: 'Póliza', previewable: false, fileType: 'document', mimeType: 'application/msword' })]));
    expect(text(h.el.querySelector('[data-detail-title]'))).toBe('Póliza');
    click('[data-action="close-detail"]');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { doc: null } }));
  });

  it('a non-previewable document says so, offers the download and fetches nothing', async () => {
    await mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }), { doc: 'd2' });
    await flushList(documentList([ownerDocument({ id: 'd2', title: 'Inventario', previewable: false, fileType: 'spreadsheet', mimeType: 'application/vnd.ms-excel' })]));
    const note = h.el.querySelector('[data-no-preview]')!;
    expect(text(note)).toContain('Vista previa no disponible para este formato');
    expect(note.querySelector('button')).not.toBeNull();
    expect(h.el.querySelector('app-document-viewer')).toBeNull();
  });

  it('«Descargar» asks for a download and saves it with the document title and extension', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/dl');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let savedAs = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      savedAs = this.download;
    });
    await mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }), { doc: 'd2' });
    await flushList(documentList([ownerDocument({ id: 'd2', title: 'Inventario', previewable: false, fileType: 'spreadsheet', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })]));
    click('[data-detail] [data-action="download"]');
    h.http.expectOne(`${API}/documents/d2/file?purpose=download`).flush(new Blob(['PK']));
    await render();
    expect(savedAs).toBe('Inventario.xlsx');
  });

  it('«Abrir documento» opens the viewed blob in a new tab with noopener', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:http://localhost/open');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }), { doc: 'd1' });
    await flushList();
    h.http.expectOne(`${API}/documents/d1/file?purpose=view`).flush(new Blob(['%PDF-']));
    await render();
    click('[data-detail] [data-action="open"]');
    h.http.expectOne(`${API}/documents/d1/file?purpose=view`).flush(new Blob(['%PDF-']));
    await render();
    expect(open).toHaveBeenCalledWith('blob:http://localhost/open', '_blank', 'noopener');
  });

  it('the row «⋯» menu offers Ver, Descargar, Abrir en una pestaña nueva and Copiar enlace, and closes on Escape', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount();
    await flushList();
    click('[data-doc="d1"] [data-row-menu]');
    expect(navigate).not.toHaveBeenCalled();
    const items = Array.from(h.el.querySelectorAll<HTMLButtonElement>('[data-doc-menu] [role=menuitem]'));
    expect(items.map(text)).toEqual(['Ver', 'Descargar', 'Abrir en una pestaña nueva', 'Copiar enlace']);
    items[3].click();
    h.fixture.detectChanges();
    await settle();
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/c\/documentacion\?doc=d1$/));
    expect(h.el.querySelector('[data-doc-menu]')).toBeNull();

    click('[data-doc="d1"] [data-row-menu]');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-doc-menu]')).toBeNull();
  });

  it('rows are keyboard-selectable', async () => {
    await mount();
    await flushList();
    const row = h.el.querySelector<HTMLElement>('[data-doc="d1"]')!;
    expect(row.tabIndex).toBe(0);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { doc: 'd1' } }));
  });

  it('shows loading, then an error when the list fails', async () => {
    await mount();
    expect(h.el.querySelector('[data-list-loading]')).not.toBeNull();
    listRequest().flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await render();
    expect(text(h.el.querySelector('[data-list-error]'))).toBe('No se pudieron cargar los documentos. Inténtalo de nuevo.');
  });
});
