import {
  DEMO_FORBIDDEN_KEYS,
  DEMO_FORBIDDEN_TRUE_FLAGS,
  validateEnv,
} from '../../../src/config/env.validation';
import { discardDemoRejectedEnv, sanitizeDemoCliEnv } from '../env-sanitize';

const SAFE = {
  DEMO_MODE: 'true',
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/domora_demo_local',
  JWT_SECRET: 'x'.repeat(40),
  SEPA_ENC_KEY: 'a'.repeat(64),
  STORAGE_DIR: '/tmp/demo',
};

function dirtyEnv(): Record<string, string> {
  const env: Record<string, string> = { ...SAFE, VERIFACTU_ENABLED: 'true' };
  for (const k of DEMO_FORBIDDEN_KEYS) env[k] = `secreto-${k}`;
  return env;
}

describe('discardDemoRejectedEnv (CLI del seed demo)', () => {
  it('elimina solo las claves que validateEnv rechaza y no toca el resto', () => {
    const env = dirtyEnv();
    const dropped = discardDemoRejectedEnv(env);
    expect(dropped.sort()).toEqual(
      [...DEMO_FORBIDDEN_KEYS, ...DEMO_FORBIDDEN_TRUE_FLAGS].sort(),
    );
    expect(env).toEqual(SAFE);
  });

  it('VERIFACTU_ENABLED=false no se toca (validateEnv lo acepta)', () => {
    const env: Record<string, string> = { ...SAFE, VERIFACTU_ENABLED: 'false' };
    expect(discardDemoRejectedEnv(env)).toEqual([]);
    expect(env['VERIFACTU_ENABLED']).toBe('false');
  });

  it('es idempotente', () => {
    const env = dirtyEnv();
    discardDemoRejectedEnv(env);
    expect(discardDemoRejectedEnv(env)).toEqual([]);
    expect(env).toEqual(SAFE);
  });

  it('el aviso lista NOMBRES y nunca valores', () => {
    const env = dirtyEnv();
    const msgs: string[] = [];
    sanitizeDemoCliEnv(env, (m) => msgs.push(m));
    expect(msgs).toHaveLength(1);
    for (const k of [...DEMO_FORBIDDEN_KEYS, ...DEMO_FORBIDDEN_TRUE_FLAGS]) {
      expect(msgs[0]).toContain(k);
    }
    expect(msgs[0]).not.toContain('secreto-');
    expect(msgs[0]).not.toContain('=true,');
  });

  it('sin claves rechazadas no emite aviso', () => {
    const msgs: string[] = [];
    sanitizeDemoCliEnv({ ...SAFE }, (m) => msgs.push(m));
    expect(msgs).toEqual([]);
  });
});

describe('lista compartida con validateEnv', () => {
  it.each([...DEMO_FORBIDDEN_KEYS])(
    'validateEnv rechaza %s con DEMO_MODE si se deja puesta',
    (key) => {
      expect(() =>
        validateEnv({ ...SAFE, [key]: 'valor' } as Record<string, unknown>),
      ).toThrow(key);
    },
  );

  it.each([...DEMO_FORBIDDEN_TRUE_FLAGS])(
    'validateEnv rechaza %s=true con DEMO_MODE',
    (key) => {
      expect(() =>
        validateEnv({ ...SAFE, [key]: 'true' } as Record<string, unknown>),
      ).toThrow(`${key}=true`);
    },
  );

  it('tras el descarte validateEnv pasa', () => {
    const env = dirtyEnv();
    discardDemoRejectedEnv(env);
    expect(() => validateEnv(env)).not.toThrow();
  });
});

describe('regresion: .env de desarrollo contamina el CLI', () => {
  it('con VERIFACTU_ENABLED=true y Stripe: la API sigue abortando, el CLI no', () => {
    const base = {
      ...SAFE,
      VERIFACTU_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_x',
    };
    // API (validateEnv directo, sin descarte): estricta.
    expect(() => validateEnv({ ...base })).toThrow(/VERIFACTU_ENABLED=true/);
    expect(() => validateEnv({ ...base })).toThrow(/STRIPE_SECRET_KEY/);
    // CLI: descarta y valida.
    const cli = { ...base };
    sanitizeDemoCliEnv(cli, () => undefined);
    expect(() => validateEnv(cli)).not.toThrow();
  });

  it('importar seed-demo NO valida el entorno (DemoSeedModule se carga tarde)', () => {
    const saved = { ...process.env };
    Object.assign(process.env, SAFE, {
      VERIFACTU_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_x',
    });
    try {
      jest.isolateModules(() => {
        expect(() => require('../seed-demo')).not.toThrow();
      });
    } finally {
      for (const k of Object.keys(process.env)) {
        if (!(k in saved)) delete process.env[k];
      }
      Object.assign(process.env, saved);
    }
  });
});
