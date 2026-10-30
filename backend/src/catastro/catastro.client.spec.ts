import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CatastroClient } from './catastro.client';
import { CatastroError } from './catastro.types';

function fixtureText(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

function response(body: string, init: { status?: number } = {}): Response {
  return new Response(body, { status: init.status ?? 200 });
}

function makeClient(env: Record<string, string> = {}): CatastroClient {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new CatastroClient(config);
}

describe('CatastroClient', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    // Los fallos simulados loguean un warning; no ensuciar la salida de los tests.
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('consulta la parcela por referencia y devuelve las unidades normalizadas', async () => {
    fetchMock.mockResolvedValue(response(fixtureText('building-list.json')));

    const parcel = await makeClient().byReference('2853604VK4725D');

    expect(parcel.units).toHaveLength(34);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfCallejero/COVCCallejero.svc/json/Consulta_DNPRC?RefCat=2853604VK4725D',
    );
  });

  it('codifica los parámetros con %20 (no "+") y respeta las eñes', async () => {
    fetchMock.mockResolvedValue(response(fixtureText('by-address.json')));

    await makeClient().byAddress({
      provincia: 'MADRID',
      municipio: 'ALCALA DE HENARES',
      sigla: 'CL',
      calle: 'BLASCO IBAÑEZ',
      numero: '10',
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('Municipio=ALCALA%20DE%20HENARES');
    expect(url).toContain('Calle=BLASCO%20IBA%C3%91EZ');
    expect(url).not.toContain('+');
    expect(url).toContain('Sigla=CL');
    expect(url).toContain('Numero=10');
  });

  it('tolera el BOM UTF-8 delante del JSON', async () => {
    fetchMock.mockResolvedValue(
      response('\uFEFF' + fixtureText('provinces.json')),
    );

    const provinces = await makeClient().provinces();

    expect(provinces).toHaveLength(48);
  });

  it('usa CATASTRO_BASE_URL (sin barra final) si está configurada', async () => {
    fetchMock.mockResolvedValue(response(fixtureText('provinces.json')));

    await makeClient({
      CATASTRO_BASE_URL: 'https://proxy.example.test/catastro/',
    }).provinces();

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://proxy.example.test/catastro/ObtenerProvincias',
    );
  });

  it('CATASTRO_ENABLED=false: no llama a la red y lo dice', async () => {
    const client = makeClient({ CATASTRO_ENABLED: 'false' });

    await expect(client.provinces()).rejects.toMatchObject({
      kind: 'unavailable',
      message: expect.stringContaining('desactivada'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'HTTP 503',
      () => fetchMock.mockResolvedValue(response('down', { status: 503 })),
    ],
    [
      'la red cae',
      () => fetchMock.mockRejectedValue(new TypeError('fetch failed')),
    ],
    [
      'timeout',
      () =>
        fetchMock.mockRejectedValue(
          new DOMException('timed out', 'TimeoutError'),
        ),
    ],
    [
      'el cuerpo no es JSON (página HTML de error)',
      () => fetchMock.mockResolvedValue(response('<html>Error</html>')),
    ],
  ])('%s → CatastroError "unavailable"', async (_name, arrange) => {
    arrange();

    const err = await makeClient()
      .byReference('2853604VK4725D')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CatastroError);
    expect(err).toMatchObject({ kind: 'unavailable' });
  });

  it('un error funcional del Catastro (HTTP 200 con lerr) sale como not_found, no como éxito', async () => {
    fetchMock.mockResolvedValue(response(fixtureText('err-street.json')));

    await expect(
      makeClient().byAddress({
        provincia: 'MADRID',
        municipio: 'MADRID',
        sigla: 'CL',
        calle: 'ZZZ',
        numero: '1',
      }),
    ).rejects.toMatchObject({ kind: 'not_found', code: '33' });
  });
});
