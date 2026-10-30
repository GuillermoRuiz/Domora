import { ConfigService } from '@nestjs/config';
import { CatastroFacadeService } from './catastro-facade.service';

describe('facade cache', () => {
  it('compare-and-set evita escribir una fachada sobre otra RC', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = new CatastroFacadeService(new ConfigService(), {
      estate: { updateMany },
    } as never);
    jest.spyOn(service, 'resolveFacadeUrl').mockResolvedValue(null);
    await service.refreshEstate('e1', '1907401VK4810H');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'e1',
          cadastralReference: '1907401VK4810H',
          deletedAt: null,
        },
      }),
    );
  });
  it('fallo de caché no convierte un alta/importación ya guardada en error', async () => {
    const service = new CatastroFacadeService(new ConfigService(), {
      estate: { updateMany: jest.fn().mockRejectedValue(new Error('db')) },
    } as never);
    jest.spyOn(service, 'resolveFacadeUrl').mockResolvedValue(null);
    await expect(
      service.refreshEstate('e1', '1907401VK4810H'),
    ).resolves.toBeNull();
  });
  it('backfill estricto informa los fallos de persistencia para poder reintentar', async () => {
    const service = new CatastroFacadeService(new ConfigService(), {
      estate: { updateMany: jest.fn().mockRejectedValue(new Error('db')) },
    } as never);
    jest.spyOn(service, 'resolveFacadeUrl').mockResolvedValue(null);
    await expect(
      service.refreshEstate('e1', '1907401VK4810H', true),
    ).rejects.toThrow('db');
  });
});
