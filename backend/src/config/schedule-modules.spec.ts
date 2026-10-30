import { scheduleModules } from './schedule-modules';

describe('scheduleModules', () => {
  it('con DEMO_MODE=true no registra ScheduleModule (cero crons)', () => {
    expect(scheduleModules({ DEMO_MODE: 'true' })).toEqual([]);
  });

  it('sin DEMO_MODE registra ScheduleModule como siempre', () => {
    expect(scheduleModules({})).toHaveLength(1);
    expect(scheduleModules({ DEMO_MODE: 'false' })).toHaveLength(1);
  });
});
