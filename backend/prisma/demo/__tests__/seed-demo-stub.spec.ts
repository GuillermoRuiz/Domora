import { DemoGuardError } from '../guard';
import { parseArgs, runSeedDemo, type SeedDemoDeps } from '../seed-demo';

const OK_ENV = {
  DEMO_MODE: 'true',
  DATABASE_URL: 'postgresql://u:p@db.internal:5432/domora_demo',
} as NodeJS.ProcessEnv;

/** Deps falsas: ninguna BD real. Sonda = BD vacía (la capa 4 pasa). */
function fakeDeps(hasData = false) {
  const wipe = jest.fn().mockResolvedValue({
    truncatedTables: 3,
    restoredInspectionTypes: 40,
  });
  const seed = jest.fn().mockResolvedValue(undefined);
  const markDatabase = jest.fn().mockResolvedValue(undefined);
  const disconnect = jest.fn().mockResolvedValue(undefined);
  const query = jest
    .fn()
    .mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('shobj_description')
          ? [{ comment: null }]
          : [{ has_data: hasData, has_demo_user: false }],
      ),
    );
  const deps: SeedDemoDeps = { query, wipe, seed, markDatabase, disconnect };
  return { deps, wipe, seed, markDatabase, disconnect, query };
}

describe('runSeedDemo (unitario, deps inyectadas, sin BD)', () => {
  it('sin DEMO_MODE el guard aborta: ni consulta, ni wipe, ni seed', async () => {
    const f = fakeDeps();
    await expect(
      runSeedDemo(
        { DATABASE_URL: OK_ENV['DATABASE_URL'] },
        ['--reset'],
        f.deps,
      ),
    ).rejects.toBeInstanceOf(DemoGuardError);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.wipe).not.toHaveBeenCalled();
    expect(f.seed).not.toHaveBeenCalled();
    expect(f.disconnect).toHaveBeenCalled();
  });

  it('contra una BD "domora" el guard aborta sin consultar nada', async () => {
    const f = fakeDeps();
    await expect(
      runSeedDemo(
        { DEMO_MODE: 'true', DATABASE_URL: 'postgresql://u:p@h:5432/domora' },
        ['--reset'],
        f.deps,
      ),
    ).rejects.toBeInstanceOf(DemoGuardError);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.wipe).not.toHaveBeenCalled();
  });

  it('--reset: wipe -> seed -> marcador, en ese orden', async () => {
    const f = fakeDeps();
    const order: string[] = [];
    f.wipe.mockImplementation(() => {
      order.push('wipe');
      return Promise.resolve({
        truncatedTables: 3,
        restoredInspectionTypes: 40,
      });
    });
    f.seed.mockImplementation(() => {
      order.push('seed');
      return Promise.resolve();
    });
    f.markDatabase.mockImplementation(() => {
      order.push('mark');
      return Promise.resolve();
    });
    const summary = await runSeedDemo(OK_ENV, ['--reset'], f.deps);
    expect(order).toEqual(['wipe', 'seed', 'mark']);
    expect(summary.wipe?.restoredInspectionTypes).toBe(40);
  });

  it('sin --reset sobre BD con datos aborta sin wipe ni seed', async () => {
    const f = fakeDeps(true);
    // La capa 4 exige marcador/usuario demo con datos: simulamos usuario demo.
    f.query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('shobj_description')
          ? [{ comment: 'domora:demo-seed-v1' }]
          : [{ has_data: true, has_demo_user: true }],
      ),
    );
    await expect(runSeedDemo(OK_ENV, [], f.deps)).rejects.toThrow(
      /usa --reset/,
    );
    expect(f.wipe).not.toHaveBeenCalled();
    expect(f.seed).not.toHaveBeenCalled();
    expect(f.markDatabase).not.toHaveBeenCalled();
  });

  it('si el seed falla no se escribe el marcador', async () => {
    const f = fakeDeps();
    f.seed.mockRejectedValue(new Error('boom'));
    await expect(runSeedDemo(OK_ENV, ['--reset'], f.deps)).rejects.toThrow(
      'boom',
    );
    expect(f.markDatabase).not.toHaveBeenCalled();
  });

  it('parseArgs detecta --reset y --hard (hard implica reset)', () => {
    expect(parseArgs(['--reset'])).toEqual({ reset: true, hard: false });
    expect(parseArgs([])).toEqual({ reset: false, hard: false });
    expect(parseArgs(['--hard'])).toEqual({ reset: true, hard: true });
  });

  it('--hard: migrateReset -> wipe -> seed -> marcador, y solo tras el guard', async () => {
    const f = fakeDeps();
    const order: string[] = [];
    const migrateReset = jest.fn().mockImplementation(() => {
      order.push('migrate');
      return Promise.resolve();
    });
    f.wipe.mockImplementation(() => {
      order.push('wipe');
      return Promise.resolve({
        truncatedTables: 3,
        restoredInspectionTypes: 40,
      });
    });
    f.seed.mockImplementation(() => {
      order.push('seed');
      return Promise.resolve();
    });
    f.markDatabase.mockImplementation(() => {
      order.push('mark');
      return Promise.resolve();
    });
    const summary = await runSeedDemo(OK_ENV, ['--reset', '--hard'], {
      ...f.deps,
      migrateReset,
    });
    expect(order).toEqual(['migrate', 'wipe', 'seed', 'mark']);
    expect(summary.hard).toBe(true);
  });

  it('--hard contra una BD "domora" o sin DEMO_MODE: el guard aborta, migrateReset NO se llama', async () => {
    const f = fakeDeps();
    const migrateReset = jest.fn().mockResolvedValue(undefined);
    const deps = { ...f.deps, migrateReset };
    await expect(
      runSeedDemo(
        { DEMO_MODE: 'true', DATABASE_URL: 'postgresql://u:p@h:5432/domora' },
        ['--hard'],
        deps,
      ),
    ).rejects.toBeInstanceOf(DemoGuardError);
    await expect(
      runSeedDemo({ DATABASE_URL: OK_ENV['DATABASE_URL'] }, ['--hard'], deps),
    ).rejects.toBeInstanceOf(DemoGuardError);
    expect(migrateReset).not.toHaveBeenCalled();
    expect(f.wipe).not.toHaveBeenCalled();
  });

  it('--hard sin migrateReset disponible falla antes de borrar nada', async () => {
    const f = fakeDeps();
    await expect(runSeedDemo(OK_ENV, ['--hard'], f.deps)).rejects.toThrow(
      /migrateReset/,
    );
    expect(f.wipe).not.toHaveBeenCalled();
  });

  it('sin --hard migrateReset nunca se llama (--reset normal)', async () => {
    const f = fakeDeps();
    const migrateReset = jest.fn().mockResolvedValue(undefined);
    await runSeedDemo(OK_ENV, ['--reset'], { ...f.deps, migrateReset });
    expect(migrateReset).not.toHaveBeenCalled();
  });
});
