import { API, setupApiService, type ApiServiceHarness } from './testing/data-service-harness';
import { AccountingService } from './accounting.service';

describe('AccountingService', () => {
  let h: ApiServiceHarness<AccountingService>;

  beforeEach(() => {
    h = setupApiService(AccountingService);
  });

  afterEach(() => h.http.verify());

  describe('mapAccountingEstate (vía listAccountingEstates/findAccountingEstateById)', () => {
    it('listAccountingEstates primero lista las fincas y luego pide el resumen contable de cada una', async () => {
      const promise = h.service.listAccountingEstates();

      const listReq = h.http.expectOne(`${API}/estates`);
      listReq.flush([
        { id: 'e1', administratorId: 'a1', name: 'Finca A', type: 'Edificio', address: 'Calle Mayor', streetNumber: '12', location: 'Madrid', catastroFacadeUrl: '/api/v1/estates/e1/facade', reserveTarget: '0' },
        { id: 'e2', administratorId: 'a1', name: 'Finca B', type: 'Edificio', address: 'x', location: 'x', reserveTarget: '0' },
      ]);
      // Sin zone.js (app zoneless) no hay fakeAsync/tick — se deja un tick real
      // para que el .then() que dispara el Promise.all de resúmenes corra
      // antes de esperar esas peticiones.
      await new Promise((resolve) => setTimeout(resolve));

      // El fan-out es Promise.all — ambas peticiones de resumen deben dispararse.
      const summaryReq1 = h.http.expectOne(`${API}/estates/e1/accounting/summary`);
      const summaryReq2 = h.http.expectOne(`${API}/estates/e2/accounting/summary`);
      summaryReq1.flush({ id: 'e1', administratorId: 'a1', name: 'Finca A', type: 'Edificio', balance: '1000.50', income: '500', expenses: '200', reserve: '300', reserveTarget: '1000', delinquency: '50.25', units: 10 });
      summaryReq2.flush({ id: 'e2', administratorId: 'a1', name: 'Finca B', type: 'Edificio', balance: '0', income: '0', expenses: '0', reserve: '0', reserveTarget: '0', delinquency: '0', units: 5 });

      const [a, b] = await promise;
      expect(a.balance).toBe(1000.5);
      expect(a.delinquency).toBe(50.25);
      expect(b.units).toBe(5);
      expect(a).toMatchObject({ address: 'Calle Mayor', streetNumber: '12', location: 'Madrid', catastroFacadeUrl: '/api/v1/estates/e1/facade' });
    });

    it('findAccountingEstateById mapea los Decimal (string) a number', async () => {
      const promise = h.service.findAccountingEstateById('e1');
      const req = h.http.expectOne(`${API}/estates/e1/accounting/summary`);
      req.flush({ id: 'e1', administratorId: 'a1', name: 'x', type: 'Edificio', balance: '10', income: '20', expenses: '5', reserve: '3', reserveTarget: '100', delinquency: '0', units: 1 });
      const result = await promise;
      expect(result?.balance).toBe(10);
      expect(typeof result?.balance).toBe('number');
    });

    it('findAccountingEstateById devuelve null si falla', async () => {
      const promise = h.service.findAccountingEstateById('no-existe');
      const req = h.http.expectOne(`${API}/estates/no-existe/accounting/summary`);
      req.flush({ message: 'not found' }, { status: 404, statusText: 'Not Found' });
      expect(await promise).toBeNull();
    });
  });

  describe('listChartAccounts — cacheado por finca', () => {
    it('la primera llamada pide a la API', async () => {
      const promise = h.service.listChartAccounts('e1');
      const req = h.http.expectOne(`${API}/estates/e1/chart-accounts`);
      req.flush([{ id: 'c1', estateId: 'e1', code: '628', name: 'Suministros' }]);
      const result = await promise;
      expect(result).toHaveLength(1);
    });

    it('la segunda llamada para la MISMA finca usa el caché — no dispara una segunda petición', async () => {
      const p1 = h.service.listChartAccounts('e1');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([{ id: 'c1', estateId: 'e1', code: '628', name: 'Suministros' }]);
      await p1;

      const result2 = await h.service.listChartAccounts('e1');
      expect(result2).toHaveLength(1);
      h.http.expectNone(`${API}/estates/e1/chart-accounts`);
    });

    it('una finca distinta sí dispara su propia petición — el caché es por finca', async () => {
      const p1 = h.service.listChartAccounts('e1');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([{ id: 'c1', estateId: 'e1', code: '628', name: 'x' }]);
      await p1;

      const p2 = h.service.listChartAccounts('e2');
      const req2 = h.http.expectOne(`${API}/estates/e2/chart-accounts`);
      req2.flush([{ id: 'c2', estateId: 'e2', code: '700', name: 'y' }]);
      const result2 = await p2;
      expect(result2[0].code).toBe('700');
    });

    it('findChartAccount busca por código dentro del caché (poblándolo si hace falta)', async () => {
      const promise = h.service.findChartAccount('e1', '628');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([
        { id: 'c1', estateId: 'e1', code: '628', name: 'Suministros' },
        { id: 'c2', estateId: 'e1', code: '700', name: 'Cuotas' },
      ]);
      expect((await promise)?.name).toBe('Suministros');
    });

    it('findChartAccount devuelve null si el código no existe', async () => {
      const promise = h.service.findChartAccount('e1', 'no-existe');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([{ id: 'c1', estateId: 'e1', code: '628', name: 'x' }]);
      expect(await promise).toBeNull();
    });

    it('createChartAccount añade la cuenta creada al caché existente sin perder lo ya cargado', async () => {
      const p1 = h.service.listChartAccounts('e1');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([{ id: 'c1', estateId: 'e1', code: '628', name: 'x' }]);
      await p1;

      const createPromise = h.service.createChartAccount('e1', { code: '700', name: 'Cuotas' });
      const createReq = h.http.expectOne(`${API}/estates/e1/chart-accounts`);
      expect(createReq.request.method).toBe('POST');
      // La naturaleza la deduce el backend del código: no se envía tipo.
      expect(createReq.request.body).toEqual({ code: '700', name: 'Cuotas' });
      createReq.flush({ id: 'c2', estateId: 'e1', code: '700', name: 'Cuotas' });
      await createPromise;

      const cached = await h.service.listChartAccounts('e1');
      expect(cached.map((a) => a.code)).toEqual(['628', '700']);
      h.http.expectNone(`${API}/estates/e1/chart-accounts`);
    });

    it('updateChartAccount y deleteChartAccount mantienen el caché al día', async () => {
      const p1 = h.service.listChartAccounts('e1');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([
        { id: 'c1', estateId: 'e1', code: '628', name: 'Suministros' },
        { id: 'c2', estateId: 'e1', code: '6280001', name: 'Luz' },
      ]);
      await p1;

      const upd = h.service.updateChartAccount('e1', 'c1', { name: 'Suministros comunes' });
      const updReq = h.http.expectOne(`${API}/estates/e1/chart-accounts/c1`);
      expect(updReq.request.method).toBe('PATCH');
      expect(updReq.request.body).toEqual({ name: 'Suministros comunes' });
      updReq.flush({ id: 'c1', estateId: 'e1', code: '628', name: 'Suministros comunes' });
      await upd;

      const del = h.service.deleteChartAccount('e1', 'c2');
      const delReq = h.http.expectOne(`${API}/estates/e1/chart-accounts/c2`);
      expect(delReq.request.method).toBe('DELETE');
      delReq.flush(null);
      await del;

      const cached = await h.service.listChartAccounts('e1');
      expect(cached.map((a) => `${a.code} ${a.name}`)).toEqual(['628 Suministros comunes']);
    });
  });

  describe('resolveAccountLabel (helper puro, con fallback en cascada)', () => {
    it('si viene apiLabel, se usa directo sin tocar el caché', () => {
      expect(h.service.resolveAccountLabel('e1', '628', 'Ya resuelto')).toBe('Ya resuelto');
    });

    it('sin apiLabel y sin caché poblado todavía, cae al propio código', () => {
      expect(h.service.resolveAccountLabel('e-sin-cache', '628')).toBe('628');
    });

    it('sin apiLabel pero con el caché poblado, arma "código · nombre corto"', async () => {
      const p1 = h.service.listChartAccounts('e1');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([{ id: 'c1', estateId: 'e1', code: '628', name: 'Suministros', shortName: 'Suminis.' }]);
      await p1;
      expect(h.service.resolveAccountLabel('e1', '628')).toBe('628 · Suminis.');
    });

    it('sin shortName, usa el nombre completo', async () => {
      const p1 = h.service.listChartAccounts('e1');
      h.http.expectOne(`${API}/estates/e1/chart-accounts`).flush([{ id: 'c1', estateId: 'e1', code: '628', name: 'Suministros' }]);
      await p1;
      expect(h.service.resolveAccountLabel('e1', '628')).toBe('628 · Suministros');
    });
  });
});
