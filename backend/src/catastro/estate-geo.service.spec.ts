import { ConfigService } from '@nestjs/config';
import { EstateGeoService, type LocateInput } from './estate-geo.service';
import type { PrismaService } from '../prisma/prisma.service';

const CATASTRO_JSON = JSON.stringify({ Consulta_CPMRCResult: { coordenadas: { coord: [{ geo: { xcen: '-3.46328353028033', ycen: '38.6401434830887', srs: 'EPSG:4326' } }] } } });
const PARCEL_XML = '<?xml version="1.0"?><x><cp:areaValue uom="m2">397</cp:areaValue></x>';
const NOMINATIM_JSON = JSON.stringify([{ lat: '40.4200', lon: '-3.7050' }]);

const input = (over: Partial<LocateInput> = {}): LocateInput => ({
  cadastralReference: '9872023VH5797S', address: 'Calle Gran Vía', streetNumber: '12', postalCode: '28013', location: 'Madrid', province: 'Madrid', ...over,
});

describe('EstateGeoService.locate', () => {
  let fetchMock: jest.SpyInstance;
  const env: Record<string, string> = {};
  const service = () => new EstateGeoService({ get: (k: string) => env[k] } as unknown as ConfigService, {} as PrismaService);
  const respond = (routes: Record<string, string | number>) =>
    fetchMock.mockImplementation(async (url: URL) => {
      const key = Object.keys(routes).find(k => url.toString().includes(k));
      const body = key ? routes[key] : 404;
      return typeof body === 'number' ? new Response('', { status: body }) : new Response(body, { status: 200 });
    });
  const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('uses the Catastro coordinates and parcel area of the parcel reference', async () => {
    respond({ Consulta_CPMRC: CATASTRO_JSON, wfsCP: PARCEL_XML });
    expect(await service().locate(input({ cadastralReference: '9872023VH5797S0001WX' }))).toEqual({ latitude: 38.6401434830887, longitude: -3.46328353028033, source: 'catastro', parcelAreaM2: 397 });
    expect(urls()[0]).toContain('RefCat=9872023VH5797S&');
    expect(urls().some(u => u.includes('nominatim'))).toBe(false);
  });

  it('falls back to Nominatim by address when the Catastro fails, identifying the application', async () => {
    respond({ Consulta_CPMRC: 500, nominatim: NOMINATIM_JSON });
    expect(await service().locate(input())).toEqual({ latitude: 40.42, longitude: -3.705, source: 'nominatim', parcelAreaM2: null });
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('nominatim'))!;
    expect(new URL(String(call[0])).searchParams.get('q')).toBe('Calle Gran Vía 12, 28013 Madrid, Madrid, España');
    expect((call[1].headers as Record<string, string>)['User-Agent']).toMatch(/Domora/);
  });

  it('without a cadastral reference goes straight to Nominatim', async () => {
    respond({ nominatim: NOMINATIM_JSON });
    expect((await service().locate(input({ cadastralReference: null })))?.source).toBe('nominatim');
    expect(urls().some(u => u.includes('catastro'))).toBe(false);
  });

  it('makes no external call when the Catastro and geocoding are disabled (demo mode)', async () => {
    env['CATASTRO_ENABLED'] = 'false';
    env['GEOCODING_ENABLED'] = 'false';
    respond({});
    expect(await service().locate(input())).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores empty or out-of-range answers', async () => {
    respond({ Consulta_CPMRC: JSON.stringify({ Consulta_CPMRCResult: { coordenadas: { coord: [{ geo: { xcen: '0', ycen: '0' } }] } } }), nominatim: JSON.stringify([]) });
    expect(await service().locate(input())).toBeNull();
  });

  it('spaces Nominatim requests at least one second apart, even when they arrive together', async () => {
    respond({ nominatim: NOMINATIM_JSON });
    const geo = service();
    let clock = 10_000;
    const waits: number[] = [];
    geo.now = () => clock;
    geo.sleep = async ms => { waits.push(ms); clock += ms; };
    await Promise.all([geo.locate(input({ cadastralReference: null })), geo.locate(input({ cadastralReference: null }))]);
    expect(waits).toEqual([1100]);
  });
});
