import { ConfigService } from '@nestjs/config';
import {
  CatastroFacadeService,
  normalizeCadastralReference,
  validateFacadeUrl,
} from './catastro-facade.service';

const PHOTO =
  'http://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral=1907401VK4810H';
const xml = (link = PHOTO) =>
  `<gml:FeatureCollection><gml:featureMember><bu-ext2d:Building><bu-ext2d:document><bu-ext2d:Document><bu-ext2d:documentLink>${link.replaceAll('&', '&amp;')}</bu-ext2d:documentLink></bu-ext2d:Document></bu-ext2d:document></bu-ext2d:Building></gml:featureMember></gml:FeatureCollection>`;

describe('CatastroFacadeService', () => {
  const service = new CatastroFacadeService(new ConfigService(), {
    estate: { updateMany: jest.fn() },
  } as never);
  afterEach(() => jest.restoreAllMocks());

  it('normaliza la RC completa y obtiene los primeros 14 caracteres', () => {
    expect(normalizeCadastralReference(' 7874101 wf4777s0001ui ')).toEqual({
      reference: '7874101WF4777S0001UI',
      parcelReference: '7874101WF4777S',
    });
  });
  it.each(['', '123', '7874101WF4777S!', 'x'.repeat(21)])(
    'rechaza referencia inválida %s',
    (value) => {
      expect(normalizeCadastralReference(value)).toBeNull();
    },
  );
  it('consulta StoredQuerie_id y decodifica documentLink', async () => {
    const fetcher = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(xml(PHOTO + '&x=1')));
    expect(await service.resolveFacadeUrl('1907401VK4810H')).toBe(
      PHOTO.replace('http:', 'https:') + '&x=1',
    );
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.searchParams.get('StoredQuerie_id')).toBe('GetBuildingByParcel');
    expect(url.searchParams.get('REFCAT')).toBe('1907401VK4810H');
    expect(fetcher.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it('sin documentLink devuelve null', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('<gml:FeatureCollection/>'));
    expect(await service.resolveFacadeUrl('1907401VK4810H')).toBeNull();
  });
  it.each([new DOMException('timeout', 'TimeoutError'), new Error('network')])(
    'degrada ante timeout/red',
    async (error) => {
      jest.spyOn(global, 'fetch').mockRejectedValue(error);
      expect(await service.resolveFacadeUrl('1907401VK4810H')).toBeNull();
    },
  );
  it('degrada ante error HTTP o XML malformado', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('error', { status: 503 }))
      .mockResolvedValueOnce(new Response('<broken>'));
    expect(await service.resolveFacadeUrl('1907401VK4810H')).toBeNull();
    expect(await service.resolveFacadeUrl('1907401VK4810H')).toBeNull();
  });
  it.each([
    'https://evil.test/a',
    'https://ovc.catastro.meh.es.evil.test/a',
    'https://user@ovc.catastro.meh.es/a',
    'file:///photo',
    'https://ovc.catastro.meh.es:8443/a',
    'https://ovc.catastro.meh.es/redirect',
  ])('rechaza URL no autorizada %s', (url) => {
    expect(validateFacadeUrl(url)).toBeNull();
  });
  it('no consulta referencias inválidas ni integración desactivada', async () => {
    const fetcher = jest.spyOn(global, 'fetch');
    expect(await service.resolveFacadeUrl('bad')).toBeNull();
    const disabled = new CatastroFacadeService(
      new ConfigService({ CATASTRO_ENABLED: 'false' }),
      {} as never,
    );
    expect(await disabled.resolveFacadeUrl('1907401VK4810H')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rechaza declaraciones de entidades XML', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response('<!DOCTYPE x [<!ENTITY secret "boom">]>' + xml()),
      );
    expect(await service.resolveFacadeUrl('1907401VK4810H')).toBeNull();
  });
});
