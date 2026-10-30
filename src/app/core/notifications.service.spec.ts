import { API, setupApiService } from './testing/data-service-harness';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('list: sin parámetros no manda query string', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.list();
    const req = http.expectOne((r) => r.url === `${API}/notifications`);
    expect(req.request.params.keys()).toEqual([]);
    req.flush([]);
    await promise;
  });

  it('list: pasa unread/before/limit como query params', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.list({ unread: true, before: '2026-09-20T00:00:00.000Z', limit: 10 });
    const req = http.expectOne((r) => r.url === `${API}/notifications`);
    expect(req.request.params.get('unread')).toBe('true');
    expect(req.request.params.get('before')).toBe('2026-09-20T00:00:00.000Z');
    expect(req.request.params.get('limit')).toBe('10');
    req.flush([]);
    await promise;
  });

  it('summary hace GET a /notifications/summary', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.summary();
    http.expectOne(`${API}/notifications/summary`).flush({ unreadNotifications: 2, unreadMessages: 1, pendingTasks: 3 });
    await expect(promise).resolves.toEqual({ unreadNotifications: 2, unreadMessages: 1, pendingTasks: 3 });
  });

  it('markRead hace POST a /notifications/:id/read', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.markRead('n1');
    const req = http.expectOne(`${API}/notifications/n1/read`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
    await promise;
  });

  it('markAllRead hace POST a /notifications/read-all', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.markAllRead();
    const req = http.expectOne(`${API}/notifications/read-all`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
    await promise;
  });

  it('getPreferences hace GET a /notifications/preferences', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.getPreferences();
    http.expectOne(`${API}/notifications/preferences`).flush([{ category: 'meeting', emailEnabled: false }]);
    await expect(promise).resolves.toEqual([{ category: 'meeting', emailEnabled: false }]);
  });

  it('updatePreferences hace PUT con el array envuelto en { preferences }', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.updatePreferences([{ category: 'meeting', emailEnabled: false }]);
    const req = http.expectOne(`${API}/notifications/preferences`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ preferences: [{ category: 'meeting', emailEnabled: false }] });
    req.flush([{ category: 'meeting', emailEnabled: false }]);
    await promise;
  });

  it('listTasks hace GET a /tasks', async () => {
    const { service, http } = setupApiService(NotificationsService);

    const promise = service.listTasks();
    http.expectOne(`${API}/tasks`).flush([]);
    await expect(promise).resolves.toEqual([]);
  });
});
