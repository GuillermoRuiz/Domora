// Test del control de bundle (T0.20). Ejecutar: node --test scripts/check-demo-bundle.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { checkBundle } from './check-demo-bundle.mjs';

const dirs = [];
function bundle(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const CLEAN_PROD = { 'index.html': '<html></html>', 'main-AAA.js': 'console.log("Iniciar Sesión")' };
const GOOD_DEMO = {
  'index.html': '<html></html>',
  'main-AAA.js': 'x="Entorno de demostración"',
  'chunk-BBB.js': 'y="Modo demo";z="gestora@demo.domora.app"',
};

describe('bundle de producción', () => {
  it('pasa si no hay rastro del modo demo', () => {
    assert.equal(checkBundle(bundle(CLEAN_PROD), 'prod').ok, true);
  });

  for (const leak of ['Modo demo', 'Entorno de demostración', 'owner123', 'admin123', 'super123', 'superadmin@domora.app', 'admin@domora.app', 'x@demo.domora.app', 'Demo2026!']) {
    it(`falla si se cuela "${leak}"`, () => {
      const dir = bundle({ ...CLEAN_PROD, 'chunk-V4.js': `var a="${leak}";` });
      const res = checkBundle(dir, 'prod');
      assert.equal(res.ok, false);
      assert.match(res.violations[0], /chunk-V4\.js/);
    });
  }

  it('un directorio sin ficheros de texto no cuenta como OK (build ausente)', () => {
    assert.equal(checkBundle(bundle({ 'logo.png': 'bin' }), 'prod').ok, false);
  });
});

describe('bundle demo', () => {
  it('pasa si contiene cuentas, texto del botón y banner', () => {
    assert.equal(checkBundle(bundle(GOOD_DEMO), 'demo').ok, true);
  });

  it('falla si el fileReplacements no se aplicó (falta el contenido demo)', () => {
    const res = checkBundle(bundle(CLEAN_PROD), 'demo');
    assert.equal(res.ok, false);
    assert.equal(res.violations.length, 3);
  });

  it('falla si lleva las credenciales del seed de CI', () => {
    const res = checkBundle(bundle({ ...GOOD_DEMO, 'x.js': 'p="admin123"' }), 'demo');
    assert.equal(res.ok, false);
  });
});
