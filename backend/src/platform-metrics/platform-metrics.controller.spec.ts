import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { PlatformMetricsController } from './platform-metrics.controller';

describe('PlatformMetricsController', () => {
  it('restricts the MRR metrics to the platform superadmin (role A)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, PlatformMetricsController.prototype.mrr),
    ).toEqual(['A']);
  });

  it('restricts the recent business activity to role A and passes the limit', async () => {
    expect(
      Reflect.getMetadata(
        ROLES_KEY,
        PlatformMetricsController.prototype.activity,
      ),
    ).toEqual(['A']);
    const service = { recentActivity: jest.fn().mockResolvedValue([]) };
    await new PlatformMetricsController(service as never).activity(10);
    expect(service.recentActivity).toHaveBeenCalledWith(10);
  });

  it('returns the service overview', async () => {
    const overview = { currentMrr: 1 };
    const service = { mrrOverview: jest.fn().mockResolvedValue(overview) };
    await expect(
      new PlatformMetricsController(service as never).mrr(),
    ).resolves.toBe(overview);
  });
});
