import { CompletenessCronService } from './completeness-cron.service';

describe('CompletenessCronService', () => {
  it('records the onboarding completions every night', async () => {
    const service = {
      recordOnboardingCompletions: jest.fn().mockResolvedValue(2),
    };
    await new CompletenessCronService(service as never).run();
    expect(service.recordOnboardingCompletions).toHaveBeenCalledTimes(1);
  });

  it('never throws out of the cron when the database fails', async () => {
    const service = {
      recordOnboardingCompletions: jest
        .fn()
        .mockRejectedValue(new Error('db down')),
    };
    const cron = new CompletenessCronService(service as never);
    jest
      .spyOn(
        (cron as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    await expect(cron.run()).resolves.toBeUndefined();
  });
});
