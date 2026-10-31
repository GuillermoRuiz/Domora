import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { ClientHealthController } from './client-health.controller';

const roles = (method: keyof ClientHealthController) =>
  Reflect.getMetadata(ROLES_KEY, ClientHealthController.prototype[method]);

describe('ClientHealthController', () => {
  it('exposes salud, «Requieren atención» and one despacho to role A only', () => {
    expect(roles('offices')).toEqual(['A']);
    expect(roles('office')).toEqual(['A']);
    expect(roles('attention')).toEqual(['A']);
  });

  it('delegates to the service', async () => {
    const service = {
      overview: jest
        .fn()
        .mockResolvedValue({ atRiskBelow: 70, churnRisk: 1, offices: [] }),
      office: jest.fn().mockResolvedValue({ administratorId: 'a1' }),
      attention: jest.fn().mockResolvedValue([]),
    };
    const controller = new ClientHealthController(service as never);
    await expect(controller.offices()).resolves.toEqual({
      atRiskBelow: 70,
      churnRisk: 1,
      offices: [],
    });
    await expect(controller.office('a1')).resolves.toEqual({
      administratorId: 'a1',
    });
    expect(service.office).toHaveBeenCalledWith('a1');
    await expect(controller.attention()).resolves.toEqual([]);
  });
});
