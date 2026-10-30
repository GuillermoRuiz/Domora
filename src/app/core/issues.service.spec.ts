import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { IssuesService } from './issues.service';

describe('IssuesService', () => {
  let h: ApiServiceHarness<IssuesService>;

  beforeEach(() => {
    h = setupApiService(IssuesService);
  });

  afterEach(() => h.http.verify());

  describe('de la comunidad', () => {
    it('createIssue da de alta en la FINCA (no en una vivienda) y traduce el tipo', async () => {
      const promise = h.service.createIssue('e1', { type: 'Avería', title: 'Ascensor', description: 'No sube', priority: 'Urgente' });
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/issues` && r.method === 'POST');
      expect(req.request.body).toEqual({ type: 'Averia', title: 'Ascensor', description: 'No sube', priority: 'Urgente' });
      req.flush({ id: 'c1', ref: '#1', type: 'Averia', status: 'Abierta', title: 'Ascensor', description: 'No sube', priority: 'Urgente', source: 'Propietario', date: '2026-01-05T00:00:00.000Z', scope: 'common', propertyId: null, reportedByMe: true });
      const issue = await promise;
      expect(issue).toMatchObject({ id: 'c1', reportedByMe: true, type: 'Avería' });
    });

    it('uploadIssuePhoto sube el fichero a la incidencia', async () => {
      const promise = h.service.uploadIssuePhoto('c1', new File(['x'], 'foto.jpg', { type: 'image/jpeg' }));
      const req = h.http.expectOne((r) => r.url === `${API}/issues/c1/photos` && r.method === 'POST');
      expect(req.request.body instanceof FormData).toBe(true);
      req.flush({ id: 'p1', issueId: 'c1', uploadedAt: '2026-01-05T00:00:00.000Z' });
      expect((await promise).id).toBe('p1');
    });
  });

  describe('mapIssue', () => {
    it('listIssuesForEstate traduce type/status, normaliza la fecha y pagina', async () => {
      const promise = h.service.listIssuesForEstate('e1', { page: 2, pageSize: 20 });
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/issues` && r.params.get('page') === '2' && r.params.get('pageSize') === '20');
      req.flush({
        items: [{ id: 'i1', ref: '#1', type: 'Averia', status: 'EnReparacion', title: 't', description: 'd', priority: 'Normal', source: 'Propietario', date: '2026-01-05T00:00:00.000Z', propertyId: 'p1' }],
        total: 25, page: 2, pageSize: 20,
      });
      const res = await promise;
      expect(res.items[0].type).toBe('Avería');
      expect(res.items[0].status).toBe('En reparación');
      expect(res.items[0].date).toBe('2026-01-05');
      expect(res.total).toBe(25);
    });

    it('photos/timeline ausentes caen a array vacío, no a undefined', async () => {
      const promise = h.service.listIssuesForEstate('e1');
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/issues`);
      req.flush({ items: [{ id: 'i1', ref: '#1', type: 'Otro', status: 'Abierta', title: 't', description: 'd', priority: 'Normal', source: 'Comunidad', date: '2026-01-01', propertyId: 'p1' }], total: 1, page: 1, pageSize: 50 });
      const res = await promise;
      expect(res.items[0].photos).toEqual([]);
      expect(res.items[0].timeline).toEqual([]);
    });

    it('findIssueById devuelve null si falla', async () => {
      const promise = h.service.findIssueById('no-existe');
      const req = h.http.expectOne(`${API}/issues/no-existe`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBeNull();
    });

    it('createIssue traduce el tipo hacia la API y mapea la respuesta', async () => {
      const promise = h.service.createIssue('e1', { type: 'Daño estructural', title: 't', description: 'd', priority: 'Urgente' });
      const req = h.http.expectOne(`${API}/estates/e1/issues`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ type: 'DanoEstructural', title: 't', description: 'd', priority: 'Urgente' });
      req.flush({ id: 'i1', ref: '#1', type: 'DanoEstructural', status: 'Abierta', title: 't', description: 'd', priority: 'Urgente', source: 'Propietario', date: '2026-01-01', estateId: 'e1' });
      expect((await promise).type).toBe('Daño estructural');
    });

    it('updateIssueStatus traduce el estado hacia la API', async () => {
      const promise = h.service.updateIssueStatus('i1', 'Pendiente proveedor');
      const req = h.http.expectOne(`${API}/issues/i1/status`);
      expect(req.request.body).toEqual({ status: 'PendienteProveedor' });
      req.flush({ id: 'i1', ref: '#1', type: 'Otro', status: 'PendienteProveedor', title: 't', description: 'd', priority: 'Normal', source: 'Propietario', date: '2026-01-01', propertyId: 'p1' });
      expect((await promise).status).toBe('Pendiente proveedor');
    });

    it('updateIssueBudget manda el input tal cual', async () => {
      const promise = h.service.updateIssueBudget('i1', { budgetAmount: 500, budgetApproved: true });
      const req = h.http.expectOne(`${API}/issues/i1/budget`);
      expect(req.request.body).toEqual({ budgetAmount: 500, budgetApproved: true });
      req.flush({ id: 'i1', ref: '#1', type: 'Otro', status: 'Abierta', title: 't', description: 'd', priority: 'Normal', source: 'Propietario', date: '2026-01-01', propertyId: 'p1' });
      await promise;
    });

    it('addIssueTimelineEntry normaliza la fecha de la entrada creada', async () => {
      const promise = h.service.addIssueTimelineEntry('i1', 'Un comentario');
      const req = h.http.expectOne(`${API}/issues/i1/timeline`);
      expect(req.request.body).toEqual({ text: 'Un comentario' });
      req.flush({ date: '2026-01-10T12:00:00.000Z', author: 'x', role: 'Propietario', text: 'Un comentario' });
      expect((await promise).date).toBe('2026-01-10');
    });

    it('addIssueTimelineEntry manda internal:true para una nota interna y la devuelve marcada', async () => {
      const promise = h.service.addIssueTimelineEntry('i1', 'Solo para la gestora', { internal: true });
      const req = h.http.expectOne((r) => r.url === `${API}/issues/i1/timeline` && r.method === 'POST');
      expect(req.request.body).toEqual({ text: 'Solo para la gestora', internal: true });
      req.flush({ date: '2026-01-10T12:00:00.000Z', author: 'x', role: 'Administrador', text: 'Solo para la gestora', internal: true });
      const entry = await promise;
      expect(entry.internal).toBe(true);
      expect(entry.date).toBe('2026-01-10');
    });

    it('requestIssueInfo hace POST a request-info y mapea la incidencia devuelta', async () => {
      const promise = h.service.requestIssueInfo('i1', '¿Puedes enviar una foto?');
      const req = h.http.expectOne((r) => r.url === `${API}/issues/i1/request-info` && r.method === 'POST');
      expect(req.request.body).toEqual({ text: '¿Puedes enviar una foto?' });
      req.flush({ id: 'i1', ref: '#1', type: 'Averia', status: 'PendienteInformacion', title: 't', description: 'd', priority: 'Normal', source: 'Propietario', date: '2026-01-01', estateId: 'e1', timeline: [] });
      const issue = await promise;
      expect(issue.status).toBe('Pendiente de información');
      expect(issue.type).toBe('Avería');
    });

    it('traduce los estados PendienteInformacion y Retirada, y el estado al que vuelve', async () => {
      const promise = h.service.listIssuesForEstate('e1');
      const base = { ref: '#1', type: 'Otro', title: 't', description: 'd', priority: 'Normal', source: 'Propietario', date: '2026-01-01', estateId: 'e1' };
      h.http.expectOne((r) => r.url === `${API}/estates/e1/issues`).flush({
        items: [
          { ...base, id: 'i1', status: 'PendienteInformacion', statusBeforeInfoRequest: 'EnReparacion' },
          { ...base, id: 'i2', status: 'Retirada' },
        ],
        total: 2, page: 1, pageSize: 25,
      });
      const res = await promise;
      expect(res.items.map(i => i.status)).toEqual(['Pendiente de información', 'Retirada']);
      expect(res.items[0].statusBeforeInfoRequest).toBe('En reparación');
    });
  });

  describe('Proveedor asignado', () => {
    it('currentIssueProvider devuelve el proveedor actual', async () => {
      const promise = h.service.currentIssueProvider('i1');
      const req = h.http.expectOne(`${API}/issues/i1/provider`);
      req.flush({ id: 'a1', issueId: 'i1', providerNameSnapshot: 'Fontanería X', assignedAt: '2026-01-01', assignedByUserId: 'u1' });
      expect((await promise)?.providerNameSnapshot).toBe('Fontanería X');
    });

    it('currentIssueProvider devuelve null si falla (sin proveedor asignado)', async () => {
      const promise = h.service.currentIssueProvider('i1');
      const req = h.http.expectOne(`${API}/issues/i1/provider`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBeNull();
    });

    it('listIssueProviderHistory — GET simple', async () => {
      const promise = h.service.listIssueProviderHistory('i1');
      const req = h.http.expectOne(`${API}/issues/i1/provider/history`);
      req.flush([{ id: 'a1', issueId: 'i1', providerNameSnapshot: 'x', assignedAt: '2026-01-01', assignedByUserId: 'u1', unassignedAt: '2026-01-05' }]);
      expect((await promise)).toHaveLength(1);
    });

    it('assignIssueProvider convierte campos vacíos/falsy a undefined (no manda "" al backend)', async () => {
      const promise = h.service.assignIssueProvider({
        issueId: 'i1', providerNameSnapshot: 'Ad-hoc', categorySnapshot: '', phoneSnapshot: '', estimatedResolutionDate: '', assignedAt: '2026-01-01', assignedByUserId: 'u1',
      });
      const req = h.http.expectOne(`${API}/issues/i1/provider`);
      expect(req.request.body).toEqual({
        supplierId: undefined, providerNameSnapshot: 'Ad-hoc', categorySnapshot: undefined, phoneSnapshot: undefined, estimatedResolutionDate: undefined,
      });
      req.flush({ id: 'a1', issueId: 'i1', providerNameSnapshot: 'Ad-hoc', assignedAt: '2026-01-01', assignedByUserId: 'u1' });
      await promise;
    });

    it('assignIssueProvider conserva supplierId cuando viene informado', async () => {
      const promise = h.service.assignIssueProvider({
        issueId: 'i1', supplierId: 's1', providerNameSnapshot: 'Fontanería X', assignedAt: '2026-01-01', assignedByUserId: 'u1',
      });
      const req = h.http.expectOne(`${API}/issues/i1/provider`);
      expect(req.request.body.supplierId).toBe('s1');
      req.flush({ id: 'a1', issueId: 'i1', providerNameSnapshot: 'Fontanería X', assignedAt: '2026-01-01', assignedByUserId: 'u1' });
      await promise;
    });
  });

  describe('Notificaciones de incidencia', () => {
    it('listIssueNotifications — GET simple', async () => {
      const promise = h.service.listIssueNotifications('i1');
      const req = h.http.expectOne(`${API}/issues/i1/notifications`);
      req.flush([{ id: 'n1', issueId: 'i1', sentAt: '2026-01-01', recipientsCount: 3, channel: 'email', sentByUserId: 'u1' }]);
      expect((await promise)).toHaveLength(1);
    });

    it('countIssueNotifications cuenta el resultado de listIssueNotifications', async () => {
      const promise = h.service.countIssueNotifications('i1');
      const req = h.http.expectOne(`${API}/issues/i1/notifications`);
      req.flush([{ id: 'n1' }, { id: 'n2' }]);
      expect(await promise).toBe(2);
    });

    it('lastIssueNotification devuelve la primera de la lista (más reciente primero)', async () => {
      const promise = h.service.lastIssueNotification('i1');
      const req = h.http.expectOne(`${API}/issues/i1/notifications`);
      req.flush([{ id: 'n-mas-reciente' }, { id: 'n-vieja' }]);
      expect((await promise)?.id).toBe('n-mas-reciente');
    });

    it('lastIssueNotification devuelve null si no hay ninguna', async () => {
      const promise = h.service.lastIssueNotification('i1');
      const req = h.http.expectOne(`${API}/issues/i1/notifications`);
      req.flush([]);
      expect(await promise).toBeNull();
    });

    it('sendIssueNotification manda solo los campos relevantes', async () => {
      const promise = h.service.sendIssueNotification({ issueId: 'i1', recipientsCount: 5, channel: 'sms', sentAt: '2026-01-01', sentByUserId: 'u1', subject: 'Aviso', body: 'texto' });
      const req = h.http.expectOne(`${API}/issues/i1/notifications`);
      expect(req.request.body).toEqual({ recipientsCount: 5, channel: 'sms', subject: 'Aviso', body: 'texto' });
      req.flush({ id: 'n1', issueId: 'i1', sentAt: '2026-01-01', recipientsCount: 5, channel: 'sms', sentByUserId: 'u1' });
      await promise;
    });
  });

  describe('instalación vinculada (opcional)', () => {
    it('createIssue manda assetId solo si se indica', async () => {
      const without = h.service.createIssue('e1', { type: 'Fuga', title: 'x', description: 'y', priority: 'Normal' });
      const req1 = h.http.expectOne(`${API}/estates/e1/issues`);
      expect(req1.request.body).not.toHaveProperty('assetId');
      req1.flush({ id: 'i1', type: 'Fuga', status: 'Abierta', date: '2026-03-01', timeline: [] });
      await without;

      const withAsset = h.service.createIssue('e1', { type: 'Fuga', title: 'x', description: 'y', priority: 'Normal', assetId: 'a1' });
      const req2 = h.http.expectOne(`${API}/estates/e1/issues`);
      expect(req2.request.body.assetId).toBe('a1');
      req2.flush({ id: 'i2', type: 'Fuga', status: 'Abierta', date: '2026-03-01', timeline: [], assetId: 'a1', asset: { id: 'a1', name: 'Cubierta' } });
      expect((await withAsset).asset).toEqual({ id: 'a1', name: 'Cubierta' });
    });

    it('setIssueAsset hace PATCH a /issues/:id/asset (null la desvincula) y devuelve la incidencia traducida', async () => {
      const promise = h.service.setIssueAsset('i1', null);
      const req = h.http.expectOne(`${API}/issues/i1/asset`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ assetId: null });
      req.flush({ id: 'i1', type: 'Averia', status: 'EnReparacion', date: '2026-03-01T00:00:00.000Z', timeline: [], assetId: null, asset: null });
      const issue = await promise;
      expect(issue.type).toBe('Avería');
      expect(issue.status).toBe('En reparación');
      expect(issue.assetId).toBeNull();
    });

    it('listIssuesForEstate puede filtrar por instalación', async () => {
      const promise = h.service.listIssuesForEstate('e1', { pageSize: 50, assetId: 'a1' });
      const req = h.http.expectOne((r) => r.url === `${API}/estates/e1/issues`);
      expect(req.request.params.get('assetId')).toBe('a1');
      req.flush({ items: [], total: 0, page: 1, pageSize: 50 });
      await promise;
    });
  });
});
