import { TestBed } from '@angular/core/testing';
import { API, makeUser, setupComponent, settle } from '../../core/testing/component-harness';
import { NotificacionesComponent } from './notificaciones.component';
import type { NotificationItem, TaskItem } from '../../core/models';

function makeItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1', category: 'adhesion', title: 'Nueva solicitud de adhesión', body: 'Ana quiere unirse',
    link: '/b/estates/e1?tab=requests', estateId: 'e1', propertyId: null, read: false,
    createdAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    kind: 'adhesion_requests', estateId: 'e1', estateName: 'Edificio Sol',
    title: '2 solicitudes de adhesión pendientes', count: 2, link: '/b/estates/e1?tab=requests',
    ...overrides,
  };
}

/** Rol B: carga avisos + tareas (isManager = true). */
async function loadAsManager(items: NotificationItem[] = [], tasks: TaskItem[] = []) {
  const h = setupComponent(NotificacionesComponent, { user: makeUser({ role: 'B' }) });
  h.fixture.detectChanges();
  h.http.expectOne((r) => r.url === `${API}/notifications`).flush(items);
  h.http.expectOne((r) => r.url === `${API}/tasks`).flush(tasks);
  await settle();
  h.fixture.detectChanges();
  return h;
}

describe('NotificacionesComponent', () => {
  describe('carga inicial', () => {
    it('rol B: pide avisos Y tareas en paralelo', async () => {
      const h = await loadAsManager([makeItem()], [makeTask()]);

      expect(h.component.items()).toHaveLength(1);
      expect(h.component.tasks()).toHaveLength(1);
      expect(h.component.loading()).toBe(false);
    });

    it('rol C: solo pide avisos, nunca /tasks (no es su rol)', async () => {
      const h = setupComponent(NotificacionesComponent, { user: makeUser({ role: 'C' }) });
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/notifications`).flush([makeItem()]);
      h.http.expectNone((r) => r.url === `${API}/tasks`);
      await settle();
      h.fixture.detectChanges();

      expect(h.component.items()).toHaveLength(1);
      expect(h.component.isManager()).toBe(false);
    });

    it('rol C: un aviso de documentos compartidos se etiqueta como «Documento»', async () => {
      const h = setupComponent(NotificacionesComponent, { user: makeUser({ role: 'C' }) });
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/notifications`).flush([
        makeItem({ category: 'document', title: 'Nuevos documentos de la comunidad', body: 'Acta — Junta ordinaria', link: '/c/community' }),
      ]);
      await settle();
      h.fixture.detectChanges();

      expect(h.el.querySelector('.item-row__label')?.textContent?.trim()).toBe('Documento');
      expect(h.component.categoryIcon('document')).toBe('file-text');
    });

    it('enlaza con el feed de Alertas del rol (B y C); el rol A no lo tiene', async () => {
      for (const [role, href] of [['C', '/c/alerts'], ['B', '/b/alerts'], ['A', null]] as const) {
        TestBed.resetTestingModule();
        const h = setupComponent(NotificacionesComponent, { user: makeUser({ role }) });
        h.fixture.detectChanges();
        h.http.match(() => true).forEach((r) => r.flush([]));
        await settle();
        h.fixture.detectChanges();
        expect(h.el.querySelector('[data-link="alerts"]')?.getAttribute('href') ?? null).toBe(href);
      }
    });

    it('la pestaña "Tareas" no aparece para rol C', async () => {
      const h = setupComponent(NotificacionesComponent, { user: makeUser({ role: 'C' }) });
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/notifications`).flush([]);
      await settle();
      h.fixture.detectChanges();

      const tabs = Array.from(h.el.querySelectorAll('.tab')).map((t) => t.textContent?.trim());
      expect(tabs.some((t) => t?.startsWith('Tareas'))).toBe(false);
    });
  });

  describe('pestaña Avisos', () => {
    it('cuenta y muestra solo los no leídos con el filtro activo', async () => {
      const h = await loadAsManager([makeItem({ id: 'n1', read: false }), makeItem({ id: 'n2', read: true })]);

      expect(h.component.unreadCount()).toBe(1);
      h.component.readFilter.set('unread');
      h.fixture.detectChanges();

      expect(h.el.querySelectorAll('.item-row')).toHaveLength(1);
    });

    it('abrir un aviso NO leído lo marca como leído y navega a su link', async () => {
      const h = await loadAsManager([makeItem({ id: 'n1', read: false, link: '/b/estates/e1?tab=requests' })]);
      const navigateSpy = vi.spyOn((h.component as any).router, 'navigateByUrl').mockResolvedValue(true);

      const openPromise = h.component.open(h.component.items()[0]);
      h.http.expectOne(`${API}/notifications/n1/read`).flush(null);
      await openPromise;

      expect(h.component.items()[0].read).toBe(true);
      expect(navigateSpy).toHaveBeenCalledWith('/b/estates/e1?tab=requests');
    });

    it('abrir un aviso YA leído navega directo, sin volver a llamar a markRead', async () => {
      const h = await loadAsManager([makeItem({ id: 'n1', read: true })]);
      vi.spyOn((h.component as any).router, 'navigateByUrl').mockResolvedValue(true);

      await h.component.open(h.component.items()[0]);

      h.http.expectNone((r) => r.url === `${API}/notifications/n1/read`);
    });

    it('marcar todas como leídas actualiza la lista local y muestra un toast', async () => {
      const h = await loadAsManager([makeItem({ id: 'n1', read: false }), makeItem({ id: 'n2', read: false })]);

      const promise = h.component.markAllRead();
      h.http.expectOne(`${API}/notifications/read-all`).flush(null);
      await promise;
      h.fixture.detectChanges();

      expect(h.component.unreadCount()).toBe(0);
      expect(h.el.querySelector('.toast')?.textContent).toContain('Todas las notificaciones marcadas como leídas');
    });

    it('sin avisos muestra el estado vacío correspondiente al filtro', async () => {
      const h = await loadAsManager([]);

      expect(h.el.textContent).toContain('No tienes avisos todavía');
    });
  });

  describe('pestaña Tareas', () => {
    it('abrir una tarea navega a su link (las tareas no se marcan como leídas)', async () => {
      const h = await loadAsManager([], [makeTask()]);
      h.component.tab.set('tareas');
      h.fixture.detectChanges();
      const navigateSpy = vi.spyOn((h.component as any).router, 'navigateByUrl').mockResolvedValue(true);

      h.component.openTask(h.component.tasks()[0]);

      expect(navigateSpy).toHaveBeenCalledWith('/b/estates/e1?tab=requests');
      h.http.expectNone((r) => r.method === 'POST');
    });

    it('el contador de la pestaña suma el count de cada tarea, no el número de filas', async () => {
      const h = await loadAsManager([], [makeTask({ count: 2 }), makeTask({ kind: 'issues_open', count: 3 })]);

      expect(h.component.pendingTaskCount()).toBe(5);
    });

    it('sin tareas pendientes muestra el estado vacío', async () => {
      const h = await loadAsManager([], []);
      h.component.tab.set('tareas');
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('No tienes tareas pendientes');
    });
  });
});
