import { MandatesService } from './mandates.service';

describe('MandatesService.onModuleInit y DEMO_MODE', () => {
  const original = process.env.DEMO_MODE;
  let setIntervalSpy: jest.SpyInstance;

  const build = () =>
    new MandatesService({} as never, {} as never, {} as never, {} as never);

  beforeEach(() => {
    setIntervalSpy = jest.spyOn(global, 'setInterval');
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  it('con DEMO_MODE=true no arma el timer', () => {
    process.env.DEMO_MODE = 'true';
    build().onModuleInit();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('sin DEMO_MODE arma el timer diario (comportamiento actual)', () => {
    delete process.env.DEMO_MODE;
    build().onModuleInit();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(24 * 60 * 60 * 1000);
    // El timer es unref(): limpiar el handle devuelto para no dejar abierto.
    clearInterval(setIntervalSpy.mock.results[0].value as NodeJS.Timeout);
  });
});
