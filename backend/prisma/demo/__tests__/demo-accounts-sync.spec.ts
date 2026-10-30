import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { DEMO_ACCOUNT_SPECS, DEMO_PASSWORD } from '../data/accounts';

/**
 * T1.4 — los emails y la contraseña que muestra el bundle demo del front
 * (`src/app/demo/demo-accounts.ts`) DEBEN coincidir con los que crea el seed.
 * Este test lee el fichero del front como texto (sin importarlo: el backend
 * no compila código de Angular) y falla si dejan de coincidir.
 */
const FRONT_FILE = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'src',
  'app',
  'demo',
  'demo-accounts.ts',
);

describe('cuentas demo: front y seed en sincronía (T1.4)', () => {
  const source = readFileSync(FRONT_FILE, 'utf-8');

  it('la contraseña pública del front es la del seed', () => {
    const m = /const DEMO_PASSWORD = '([^']+)'/.exec(source);
    expect(m?.[1]).toBe(DEMO_PASSWORD);
  });

  it('las 5 cuentas del front (rol y email, en orden) son las del seed', () => {
    const rows = [
      ...source.matchAll(/role: '([ABC])'[^}]*?email: '([^']+)'/g),
    ].map((m) => ({ role: m[1], email: m[2] }));
    expect(rows).toEqual(
      DEMO_ACCOUNT_SPECS.map((a) => ({ role: a.role, email: a.email })),
    );
  });

  it('el front no define contraseñas propias por cuenta ni usa las del seed mínimo de CI', () => {
    expect(source).not.toMatch(/admin123|owner123|super123/);
    expect(source).not.toMatch(/password: '/);
    expect(source.match(/password: DEMO_PASSWORD/g)).toHaveLength(
      DEMO_ACCOUNT_SPECS.length,
    );
  });

  it('la contraseña demo es distinta de las del seed mínimo de CI', () => {
    expect(['admin123', 'owner123', 'super123']).not.toContain(DEMO_PASSWORD);
    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });
});
