import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { ComunicadosTabComponent } from './comunicados-tab.component';
import type { Communication } from '../../../core/models';

function makeComm(overrides: Partial<Communication> = {}): Communication {
  return {
    id: 'c1',
    title: 'Corte de agua programado',
    body: 'El día 12 se cortará el suministro de 10 a 12h.',
    date: '2026-01-01',
    from: 'Gestoría Domora',
    authorUserId: 'u-autor',
    authorName: 'Gestoría Domora',
    archived: false,
    activeUntil: null,
    lastEditedByUserId: null,
    lastEditedByName: null,
    lastEditedAt: null,
    category: 'General',
    isLegalNotice: false,
    replies: [],
    attachments: [],
    ...overrides,
  };
}

/**
 * Piloto "inteligente": ComunicadosService real (peticiones capturadas por
 * HttpTestingController), calcado de documentos-tab.component.spec.ts. B
 * administra CUALQUIER comunicado (sin chequeo de propiedad en cliente), a
 * diferencia del rol C que solo edita/elimina lo suyo.
 */
describe('ComunicadosTabComponent', () => {
  let h: ComponentHarness<ComunicadosTabComponent>;

  beforeEach(() => {
    h = setupComponent(ComunicadosTabComponent);
    h.component.estateId = 'e1';
  });

  afterEach(() => h.http.verify());

  function flushInitialLoad(page: { items: Communication[]; total: number; page: number; pageSize: number }, filter = 'active'): void {
    h.fixture.detectChanges(); // dispara ngOnInit -> reload()
    const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications`);
    expect(req.request.params.get('pageSize')).toBe('30');
    expect(req.request.params.get('filter')).toBe(filter);
    req.flush(page);
  }

  it('muestra "Cargando…" mientras la primera página está en vuelo', () => {
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Cargando');
    h.http.expectOne((r) => r.url === `${API}/estates/e1/communications`).flush({ items: [], total: 0, page: 1, pageSize: 30 });
  });

  it('pinta las tarjetas con los comunicados de la primera página', async () => {
    flushInitialLoad({
      items: [makeComm({ id: 'c1', title: 'Corte de agua' }), makeComm({ id: 'c2', title: 'Junta anual' })],
      total: 2, page: 1, pageSize: 30,
    });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.querySelectorAll('.comm-card')).toHaveLength(2);
    expect(h.el.textContent).toContain('Corte de agua');
    expect(h.el.textContent).toContain('Junta anual');
  });

  it('sin comunicados, muestra el estado vacío en vez de una lista en blanco', async () => {
    flushInitialLoad({ items: [], total: 0, page: 1, pageSize: 30 });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Todavía no hay comunicados publicados');
  });

  it('muestra la traza "editado por" solo cuando el último editor no es el autor original', async () => {
    flushInitialLoad({
      items: [
        makeComm({ id: 'c1', authorUserId: 'u-autor', lastEditedByUserId: 'u-gestora', lastEditedByName: 'La Gestora', lastEditedAt: '2026-02-01' }),
        makeComm({ id: 'c2', authorUserId: 'u-autor', lastEditedByUserId: null }),
      ],
      total: 2, page: 1, pageSize: 30,
    });
    await settle();
    h.fixture.detectChanges();

    expect(h.el.textContent).toContain('Editado por La Gestora el 2026-02-01');
    const traces = h.el.querySelectorAll('.comm-card__trace');
    expect(traces).toHaveLength(1);
  });

  describe('filtro Activos/Archivados/Todos', () => {
    it('cambiar de filtro recarga desde la primera página con el query param correcto', async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1' })], total: 1, page: 1, pageSize: 30 }, 'active');
      await settle();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.pill')).find((b) => b.textContent?.trim() === 'Archivados') as HTMLElement).click();
      h.fixture.detectChanges();

      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications`);
      expect(req.request.params.get('filter')).toBe('archived');
      req.flush({ items: [makeComm({ id: 'c2', archived: true })], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Archivado');
    });

    it('"Todos" pide filter=all', async () => {
      flushInitialLoad({ items: [], total: 0, page: 1, pageSize: 30 }, 'active');
      await settle();
      h.fixture.detectChanges();

      (Array.from(h.el.querySelectorAll('.pill')).find((b) => b.textContent?.trim() === 'Todos') as HTMLElement).click();
      h.fixture.detectChanges();

      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications`);
      expect(req.request.params.get('filter')).toBe('all');
      req.flush({ items: [], total: 0, page: 1, pageSize: 30 });
    });
  });

  describe('paginación "Cargar más"', () => {
    it('no aparece cuando ya se muestran todos los comunicados que hay', async () => {
      flushInitialLoad({ items: [makeComm()], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).not.toContain('Cargar más');
    });

    it('aparece con el conteo real cuando quedan comunicados sin mostrar, y al pulsarlo concatena la página siguiente', async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1' })], total: 3, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Mostrando 1 de 3 comunicados');

      const loadMoreBtn = Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Cargar más'))!;
      loadMoreBtn.click();
      h.fixture.detectChanges();

      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.params.get('page') === '2');
      req.flush({ items: [makeComm({ id: 'c2' }), makeComm({ id: 'c3' })], total: 3, page: 2, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.comm-card')).toHaveLength(3);
      expect(h.el.textContent).not.toContain('Cargar más');
    });
  });

  describe('alta y edición', () => {
    beforeEach(async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1', title: 'Existente', body: 'Cuerpo existente' })], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();
    });

    function openNewModal(): void {
      const openBtn = Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Nuevo comunicado'))!;
      openBtn.click();
      h.fixture.detectChanges();
    }

    it('sin título ni cuerpo, no envía nada y muestra los errores de validación', () => {
      openNewModal();
      const footerButtons = h.el.querySelectorAll('.modal__footer button');
      (footerButtons[1] as HTMLButtonElement).click();
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.form-error')).toHaveLength(2);
      h.http.expectNone((r) => r.url === `${API}/estates/e1/communications` && r.method === 'POST');
    });

    it('con título y cuerpo, crea el comunicado y recarga la primera página', async () => {
      openNewModal();
      h.component.ncTitle.set('Nuevo aviso');
      h.component.ncBody.set('Contenido del aviso');

      const submitPromise = h.component.submitComunicado();

      const createReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'POST');
      expect(createReq.request.body).toEqual({
        title: 'Nuevo aviso', body: 'Contenido del aviso', activeUntil: undefined,
        category: 'General', targetPropertyId: undefined, isLegalNotice: false,
      });
      createReq.flush(makeComm({ id: 'c-nuevo', title: 'Nuevo aviso' }));
      await settle();

      const reloadReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET');
      reloadReq.flush({ items: [makeComm({ id: 'c-nuevo', title: 'Nuevo aviso' })], total: 1, page: 1, pageSize: 30 });
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showNuevoComunicado()).toBe(false);
      expect(h.el.textContent).toContain('Comunicado publicado correctamente');
    });

    it('openEdit precarga el formulario y guarda vía PATCH sin chequeo de propiedad', async () => {
      const existing = makeComm({ id: 'c1', title: 'Existente', body: 'Cuerpo existente', authorUserId: 'otro-usuario' });
      h.component.openEdit(existing);
      h.fixture.detectChanges();

      expect(h.component.ncTitle()).toBe('Existente');
      expect(h.component.ncBody()).toBe('Cuerpo existente');
      expect(h.el.textContent).toContain('Editar comunicado');

      h.component.ncTitle.set('Existente editado');
      const submitPromise = h.component.submitComunicado();

      const patchReq = h.http.expectOne((r) => r.url === `${API}/communications/c1` && r.method === 'PATCH');
      expect(patchReq.request.body).toEqual({
        title: 'Existente editado', body: 'Cuerpo existente', activeUntil: null,
        category: 'General', targetPropertyId: null, isLegalNotice: false,
      });
      patchReq.flush(makeComm({ id: 'c1', title: 'Existente editado' }));
      await settle();

      const reloadReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET');
      reloadReq.flush({ items: [makeComm({ id: 'c1', title: 'Existente editado' })], total: 1, page: 1, pageSize: 30 });
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Comunicado actualizado correctamente');
    });
  });

  describe('eliminar', () => {
    beforeEach(async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1', title: 'A borrar' })], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();
    });

    it('con confirmación, elimina el comunicado y lo quita de la lista', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const promise = h.component.remove(h.component.communications()[0]);

      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1` && r.method === 'DELETE');
      req.flush(null);
      await promise;
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.comm-card')).toHaveLength(0);
      expect(h.el.textContent).toContain('Comunicado eliminado');
    });

    it('sin confirmación, no elimina nada', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await h.component.remove(h.component.communications()[0]);

      h.http.expectNone((r) => r.url === `${API}/communications/c1` && r.method === 'DELETE');
      expect(h.component.communications()).toHaveLength(1);
    });
  });

  describe('archivar/desarchivar', () => {
    beforeEach(async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1', archived: false })], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();
    });

    it('sin pedir confirmación (a diferencia de eliminar), archiva y recarga la lista', async () => {
      // No se espía window.confirm a propósito: si toggleArchived llamara a
      // confirm(), jsdom lo devolvería `undefined`/falsy y la petición PATCH
      // de abajo nunca se dispararía, así que este test ya prueba el toggle
      // reversible sin diálogo de por medio.
      const promise = h.component.toggleArchived(h.component.communications()[0]);

      const patchReq = h.http.expectOne((r) => r.url === `${API}/communications/c1/archive` && r.method === 'PATCH');
      expect(patchReq.request.body).toEqual({ archived: true });
      patchReq.flush(null);
      await settle();

      const reloadReq = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET');
      reloadReq.flush({ items: [makeComm({ id: 'c1', archived: true })], total: 1, page: 1, pageSize: 30 });
      await promise;
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Comunicado archivado');
    });
  });

  describe('categoría, destino y notificación fehaciente', () => {
    it('manda category/targetPropertyId/campos de diligencia legal cuando se marca isLegalNotice', async () => {
      flushInitialLoad({ items: [], total: 0, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      h.component.openNuevoComunicado();
      h.component.ncTitle.set('Aviso urgente');
      h.component.ncBody.set('Corte de suministro');
      h.component.ncCategory.set('Urgente');
      h.component.ncTargetProperty.set('prop-1');
      h.component.ncIsLegalNotice.set(true);
      h.component.ncLegalNoticeSignerRole.set('secretario');
      h.component.ncLegalNoticeSignerName.set('Ana Pérez');
      h.component.ncLegalNoticeReason.set('Domicilio desconocido');
      h.component.ncLegalNoticeCountersigned.set(true);

      const promise = h.component.submitComunicado();
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'POST');
      expect(req.request.body).toMatchObject({
        category: 'Urgente', targetPropertyId: 'prop-1', isLegalNotice: true,
        legalNoticeSignerRole: 'secretario', legalNoticeSignerName: 'Ana Pérez',
        legalNoticeReason: 'Domicilio desconocido', legalNoticeCountersignedByPresident: true,
      });
      req.flush(makeComm({ id: 'c-nuevo', category: 'Urgente' }));
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET')
        .flush({ items: [makeComm({ id: 'c-nuevo', category: 'Urgente' })], total: 1, page: 1, pageSize: 30 });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.showNuevoComunicado()).toBe(false);
    });

    it('muestra el badge de categoría y el estado de la diligencia legal', async () => {
      flushInitialLoad({
        items: [makeComm({
          id: 'c1', category: 'Urgente', isLegalNotice: true,
          legalNoticeSignerRole: 'presidente', legalNoticeEffective: true,
        })],
        total: 1, page: 1, pageSize: 30,
      });
      await settle();
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Urgente');
      expect(h.el.textContent).toContain('Con pleno efecto legal');
    });
  });

  describe('fijar/desfijar', () => {
    it('fija un comunicado y recarga la lista', async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1', pinnedAt: null })], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      const promise = h.component.togglePinned(h.component.communications()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/pin` && r.method === 'PATCH');
      expect(req.request.body).toEqual({ pinned: true });
      req.flush(null);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET')
        .flush({ items: [makeComm({ id: 'c1', pinnedAt: '2026-01-01T00:00:00Z' })], total: 1, page: 1, pageSize: 30 });
      await promise;
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('fijado arriba');
    });
  });

  describe('respuestas', () => {
    it('envía una respuesta y recarga la lista', async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1', replies: [] })], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      h.component.setReplyDraft('c1', 'Gracias por avisar');
      const promise = h.component.submitReply(h.component.communications()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/replies` && r.method === 'POST');
      expect(req.request.body).toEqual({ text: 'Gracias por avisar' });
      req.flush({ id: 'r1', communicationId: 'c1', authorName: 'Gestora', role: 'Administrador', text: 'Gracias por avisar', createdAt: '2026-01-01' });
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET')
        .flush({
          items: [makeComm({ id: 'c1', replies: [{ id: 'r1', communicationId: 'c1', authorName: 'Gestora', role: 'Administrador', text: 'Gracias por avisar', createdAt: '2026-01-01' }] })],
          total: 1, page: 1, pageSize: 30,
        });
      await promise;
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Gracias por avisar');
      expect(h.component.replyDraft('c1')).toBe('');
    });

    it('elimina una respuesta con confirmación (moderación B, sin chequeo de propiedad)', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      flushInitialLoad({
        items: [makeComm({ id: 'c1', replies: [{ id: 'r1', communicationId: 'c1', authorName: 'Vecino', role: 'Propietario', text: 'x', createdAt: '2026-01-01' }] })],
        total: 1, page: 1, pageSize: 30,
      });
      await settle();
      h.fixture.detectChanges();

      const promise = h.component.deleteReply(h.component.communications()[0], 'r1');
      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/replies/r1` && r.method === 'DELETE');
      req.flush(null);
      await settle();
      h.http.expectOne((r) => r.url === `${API}/estates/e1/communications` && r.method === 'GET')
        .flush({ items: [makeComm({ id: 'c1', replies: [] })], total: 1, page: 1, pageSize: 30 });
      await promise;
      h.fixture.detectChanges();

      expect(h.el.textContent).not.toContain('Vecino');
    });
  });

  describe('lecturas', () => {
    it('abre la vista de lecturas y muestra quién ha leído', async () => {
      flushInitialLoad({ items: [makeComm({ id: 'c1' })], total: 1, page: 1, pageSize: 30 });
      await settle();
      h.fixture.detectChanges();

      const promise = h.component.openReads(h.component.communications()[0]);
      const req = h.http.expectOne((r) => r.url === `${API}/communications/c1/reads`);
      req.flush([
        { userId: 'u1', fullName: 'Vecino Uno', read: true, readAt: '2026-01-02' },
        { userId: 'u2', fullName: 'Vecino Dos', read: false, readAt: null },
      ]);
      await promise;
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('Vecino Uno');
      expect(h.el.textContent).toContain('Sin leer');
    });
  });
});
