import {
  assertDemoSafe,
  DEMO_DB_MARKER,
  DemoGuardError,
  type DbProbe,
  type QueryFn,
  runGuarded,
} from '../guard';

const EMPTY: DbProbe = { hasData: false, comment: null, hasDemoUser: false };
const demoEnv = (url: string, extra: Record<string, string> = {}) =>
  ({ DEMO_MODE: 'true', DATABASE_URL: url, ...extra }) as NodeJS.ProcessEnv;
const OK_URL = 'postgresql://u:p@localhost:5432/domora_demo';

describe('assertDemoSafe (4 capas)', () => {
  it('pasa en domora_demo vacía', () => {
    expect(() =>
      assertDemoSafe(
        demoEnv(OK_URL),
        { name: 'domora_demo', host: 'localhost' },
        EMPTY,
      ),
    ).not.toThrow();
  });

  it('capa 1: aborta sin DEMO_MODE', () => {
    const env = { DATABASE_URL: OK_URL } as NodeJS.ProcessEnv;
    expect(() =>
      assertDemoSafe(env, { name: 'domora_demo', host: 'localhost' }, EMPTY),
    ).toThrow(DemoGuardError);
  });

  it('capa 1: DEMO_MODE distinto de "true" no vale', () => {
    const env = demoEnv(OK_URL, { DEMO_MODE: '1' });
    expect(() =>
      assertDemoSafe(env, { name: 'domora_demo', host: 'localhost' }, EMPTY),
    ).toThrow(/DEMO_MODE/);
  });

  it.each([
    'domora',
    'Domora',
    'postgres',
    'domora_test',
    'democracy',
    'domora_demox',
  ])('capa 2: aborta con la BD "%s"', (name) => {
    expect(() =>
      assertDemoSafe(demoEnv(OK_URL), { name, host: 'localhost' }, EMPTY),
    ).toThrow(/no es una BD demo/);
  });

  it.each([
    'demo',
    'domora_demo',
    'domora-demo',
    'demo_test',
    'domora_demo_test',
  ])('capa 2: acepta la BD "%s"', (name) => {
    expect(() =>
      assertDemoSafe(demoEnv(OK_URL), { name, host: 'localhost' }, EMPTY),
    ).not.toThrow();
  });

  it('capa 3: aborta con host de producción', () => {
    expect(() =>
      assertDemoSafe(
        demoEnv(OK_URL),
        {
          name: 'domora_demo',
          host: 'pg-domora-prod.postgres.database.azure.com',
        },
        EMPTY,
      ),
    ).toThrow(/producción/);
  });

  it('capa 3: respeta DEMO_ALLOWED_DB_HOSTS', () => {
    const env = demoEnv(OK_URL, { DEMO_ALLOWED_DB_HOSTS: 'db-a,db-b' });
    expect(() =>
      assertDemoSafe(env, { name: 'domora_demo', host: 'otro' }, EMPTY),
    ).toThrow(/DEMO_ALLOWED_DB_HOSTS/);
    expect(() =>
      assertDemoSafe(env, { name: 'domora_demo', host: 'db-b' }, EMPTY),
    ).not.toThrow();
  });

  it('capa 4: aborta con BD con datos y sin marcador', () => {
    expect(() =>
      assertDemoSafe(
        demoEnv(OK_URL),
        { name: 'domora_demo', host: 'localhost' },
        { hasData: true, comment: null, hasDemoUser: false },
      ),
    ).toThrow(/tiene datos/);
  });

  it('capa 4: acepta BD con datos si lleva el marcador', () => {
    expect(() =>
      assertDemoSafe(
        demoEnv(OK_URL),
        { name: 'domora_demo', host: 'localhost' },
        { hasData: true, comment: DEMO_DB_MARKER, hasDemoUser: false },
      ),
    ).not.toThrow();
  });

  it('capa 4: acepta BD con datos si hay un usuario @demo.domora.app', () => {
    expect(() =>
      assertDemoSafe(
        demoEnv(OK_URL),
        { name: 'domora_demo', host: 'localhost' },
        { hasData: true, comment: 'otro', hasDemoUser: true },
      ),
    ).not.toThrow();
  });
});

describe('runGuarded: el aborto no borra filas', () => {
  const rows = (
    hasData: boolean,
    comment: string | null,
    demoUser = false,
  ): QueryFn =>
    jest.fn(async (sql: string) =>
      sql.includes('shobj_description')
        ? [{ comment }]
        : [{ has_data: hasData, has_demo_user: demoUser }],
    );

  it('sin DEMO_MODE: no sondea la BD ni invoca el wipe', async () => {
    const wipe = jest.fn().mockResolvedValue(undefined);
    const query = rows(false, null);
    const env = { DATABASE_URL: OK_URL } as NodeJS.ProcessEnv;
    await expect(runGuarded(env, query, wipe)).rejects.toThrow(DemoGuardError);
    expect(query).not.toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
  });

  it('BD "domora": no invoca el wipe', async () => {
    const wipe = jest.fn();
    const query = rows(false, null);
    const env = demoEnv('postgresql://u:p@localhost:5432/domora');
    await expect(runGuarded(env, query, wipe)).rejects.toThrow(
      /no es una BD demo/,
    );
    expect(query).not.toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
  });

  it('host prod: no invoca el wipe', async () => {
    const wipe = jest.fn();
    const env = demoEnv(
      'postgresql://u:p@pg-prod.example.com:5432/domora_demo',
    );
    await expect(runGuarded(env, rows(false, null), wipe)).rejects.toThrow(
      /producción/,
    );
    expect(wipe).not.toHaveBeenCalled();
  });

  it('BD demo con datos sin marcador: sondea pero no invoca el wipe', async () => {
    const wipe = jest.fn();
    const query = rows(true, null);
    await expect(runGuarded(demoEnv(OK_URL), query, wipe)).rejects.toThrow(
      /tiene datos/,
    );
    expect(query).toHaveBeenCalled();
    expect(wipe).not.toHaveBeenCalled();
  });

  it('DATABASE_URL ininterpretable: aborta', async () => {
    const wipe = jest.fn();
    const env = demoEnv('esto no es una url');
    await expect(runGuarded(env, rows(false, null), wipe)).rejects.toThrow(
      DemoGuardError,
    );
    expect(wipe).not.toHaveBeenCalled();
  });

  it('domora_demo vacía: invoca el wipe una vez', async () => {
    const wipe = jest.fn().mockResolvedValue('ok');
    await expect(
      runGuarded(demoEnv(OK_URL), rows(false, null), wipe),
    ).resolves.toBe('ok');
    expect(wipe).toHaveBeenCalledTimes(1);
  });
});
