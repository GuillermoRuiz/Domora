import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { MeetingsService } from './meetings.service';

describe('MeetingsService', () => {
  let h: ApiServiceHarness<MeetingsService>;

  beforeEach(() => {
    h = setupApiService(MeetingsService);
  });

  afterEach(() => h.http.verify());

  describe('updateMeetingStatus — cierre de la junta', () => {
    it.each(['celebrada', 'cancelada'] as const)('PATCH /meetings/:id/status con status=%s', async (status) => {
      const promise = h.service.updateMeetingStatus('m1', status);
      const req = h.http.expectOne(`${API}/meetings/m1/status`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status });
      req.flush({ id: 'm1', status });
      expect((await promise).status).toBe(status);
    });

    it('no confunde el cierre de la junta con el estado de la videollamada (/state)', async () => {
      const promise = h.service.updateMeetingStatus('m1', 'celebrada');
      h.http.expectNone(`${API}/meetings/m1/state`);
      h.http.expectOne(`${API}/meetings/m1/status`).flush({ id: 'm1', status: 'celebrada' });
      await promise;
    });
  });

  describe('acta subida', () => {
    it.each([true, false])('uploadActa sube el archivo en multipart con alreadySigned=%s', async (alreadySigned) => {
      const promise = h.service.uploadActa('m1', new File(['x'], 'acta.pdf', { type: 'application/pdf' }), alreadySigned);
      const req = h.http.expectOne(`${API}/meetings/m1/acta/upload`);
      expect(req.request.method).toBe('POST');
      const body = req.request.body as FormData;
      expect(body.get('file')).toBeInstanceOf(File);
      expect(body.get('alreadySigned')).toBe(String(alreadySigned));
      req.flush({ origin: 'uploaded', upload: null, version: null, legacy: { signed: false, hasDocx: false } });
      expect((await promise).origin).toBe('uploaded');
    });

    it('downloadActaUpload pide el archivo subido', async () => {
      const promise = h.service.downloadActaUpload('m1');
      const req = h.http.expectOne(`${API}/meetings/m1/acta/file`);
      expect(req.request.method).toBe('GET');
      req.flush(new Blob(['x']));
      await promise;
    });
  });
});
