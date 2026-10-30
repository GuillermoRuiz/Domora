import { API, setupApiService } from './testing/data-service-harness';
import { OperationsService } from './operations.service';

describe('OperationsService', () => {
  it('loads a global paginated meeting list without selecting an arbitrary estate', async () => {
    const { service, http } = setupApiService(OperationsService);
    const pending = service.list('meetings', {
      page: 1,
      pageSize: 12,
      filter: 'all',
      sort: 'newest',
      search: '',
    });
    const request = http.expectOne(
      (req) => req.url === `${API}/operations/meetings`,
    );
    expect(request.request.params.has('estateId')).toBe(false);
    request.flush({
      items: [
        {
          id: 'm1',
          estateId: 'e1',
          title: 'Junta',
          status: 'convocada',
          type: 'ordinaria',
          scheduledAt1: '2026-10-20T18:00:00Z',
          estate: { id: 'e1', name: 'Sol' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 12,
      summary: { convocada: 1 },
    });
    expect((await pending).items[0]).toMatchObject({
      id: 'm1',
      date: '2026-10-20T18:00:00Z',
      statusLabel: 'Convocada',
      estate: { id: 'e1' },
    });
    http.verify();
  });
  it('normalizes the lightweight issue list contract', async () => {
    const { service, http } = setupApiService(OperationsService);
    const pending = service.list('issues', {
      estateId: 'e1',
      page: 2,
      pageSize: 12,
      filter: 'active',
      sort: 'oldest',
      search: 'agua',
    });
    const request = http.expectOne(
      (req) => req.url === `${API}/operations/issues`,
    );
    expect(request.request.params.get('estateId')).toBe('e1');
    expect(request.request.params.get('page')).toBe('2');
    request.flush({
      items: [
        {
          id: 'i1',
          title: 'Fuga',
          status: 'EnReparacion',
          type: 'Averia',
          date: '2026-10-01',
          estate: { id: 'e1', name: 'Sol' },
          description: 'Primera línea',
          ref: 'INC-1',
          situationView: null,
        },
      ],
      total: 13,
      page: 2,
      pageSize: 12,
      summary: { inProgress: 1 },
    });
    expect((await pending).items[0]).toMatchObject({
      statusLabel: 'En reparación',
      description: 'Primera línea',
      ref: 'INC-1',
      estate: { id: 'e1' },
    });
    http.verify();
  });
  it('an issue belongs to its estate (never to a property)', async () => {
    const { service, http } = setupApiService(OperationsService);
    const pending = service.list('issues', { page: 1, pageSize: 12, filter: 'all', sort: 'newest', search: '' });
    http.expectOne((req) => req.url === `${API}/operations/issues`).flush({
      items: [
        {
          id: 'c1',
          title: 'Ascensor',
          status: 'Abierta',
          type: 'Averia',
          date: '2026-10-01',
          estate: { id: 'e1', name: 'Sol' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 12,
      summary: { open: 1 },
    });
    const [row] = (await pending).items;
    expect(row.estate).toEqual({ id: 'e1', name: 'Sol' });
    expect(row).not.toHaveProperty('propertyLabel');
    http.verify();
  });
  it('keeps the projected situation of each issue, and sends the new filters', async () => {
    const { service, http } = setupApiService(OperationsService);
    const pending = service.list('issues', {
      page: 1,
      pageSize: 12,
      filter: 'waiting',
      sort: 'newest',
      search: '',
      situation: 'waiting_third_party',
      ball: 'insurer',
      status: 'Abierta',
      created: '30d',
    });
    const request = http.expectOne((req) => req.url === `${API}/operations/issues`);
    expect(request.request.params.get('filter')).toBe('waiting');
    expect(request.request.params.get('ball')).toBe('insurer');
    expect(request.request.params.get('situation')).toBe('waiting_third_party');
    expect(request.request.params.get('status')).toBe('Abierta');
    expect(request.request.params.get('created')).toBe('30d');
    const situationView = { issueId: 'i1', situation: 'waiting_third_party' };
    request.flush({
      items: [
        { id: 'i1', title: 'Fuga', status: 'Abierta', type: 'Averia', date: '2026-10-01', estate: { id: 'e1' }, situationView },
        { id: 'i2', title: 'Ruido', status: 'Abierta', type: 'Averia', date: '2026-10-01', estate: { id: 'e1' } },
      ],
      total: 2,
      page: 1,
      pageSize: 12,
      summary: { all: 2, waiting: 1 },
    });
    const [first, second] = (await pending).items;
    expect(first).toMatchObject({ situation: situationView });
    expect(second).toMatchObject({ situation: null });
    http.verify();
  });
  it('maps the zone and the new statuses, and sends no category', async () => {
    const { service, http } = setupApiService(OperationsService);
    const pending = service.list('issues', {
      page: 1, pageSize: 12, filter: 'all', sort: 'newest', search: '',
    });
    const request = http.expectOne((req) => req.url === `${API}/operations/issues`);
    expect(request.request.params.has('category')).toBe(false);
    const estate = { id: 'e1', name: 'Sol', address: 'Mayor', location: 'Madrid' };
    request.flush({
      items: [
        { id: 'i1', title: 'Copia', status: 'PendienteInformacion', type: 'Otro', estate },
        { id: 'i2', title: 'Puerta', status: 'Retirada', type: 'Averia', estate },
        { id: 'i3', title: 'Antigua', status: 'Abierta', type: 'Averia', estate },
      ],
      total: 3, page: 1, pageSize: 12, summary: {},
    });
    const [first, second, third] = (await pending).items;
    expect(first).toMatchObject({ statusLabel: 'Pendiente de información', tone: 'purple' });
    expect(second).toMatchObject({ statusLabel: 'Retirada', tone: 'muted' });
    for (const row of [first, second, third]) {
      expect(row).not.toHaveProperty('scope');
      expect(row).not.toHaveProperty('category');
    }
    http.verify();
  });
  it('does not send a category when there is none', async () => {
    const { service, http } = setupApiService(OperationsService);
    void service.list('issues', { page: 1, pageSize: 12, filter: 'all', sort: 'newest', search: '' });
    const request = http.expectOne((req) => req.url === `${API}/operations/issues`);
    expect(request.request.params.has('category')).toBe(false);
    request.flush({ items: [], total: 0, page: 1, pageSize: 12, summary: {} });
    http.verify();
  });
});
