// Todos los desplegables de Domora comparten aspecto porque cada <select> pasa por
// SelectDropdownDirective (src/app/shared/components/dropdown). Una directiva standalone solo actúa
// donde se importa, así que este test falla si algún componente estrena un <select> sin importarla
// (saldría con el popup nativo del navegador). Ejecutar: node --test scripts/check-select-dropdown.test.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe('cobertura de SelectDropdownDirective', () => {
  it('todo componente con un <select> importa la directiva', () => {
    const missing = [];
    for (const file of walk(APP_DIR)) {
      if (file.endsWith('.spec.ts') || file.endsWith('.spec-helper.ts')) continue;
      const source = readFileSync(file, 'utf8');
      let owner = null;
      if (file.endsWith('.html') && /<select\b/.test(source)) owner = readFileSync(file.replace(/\.html$/, '.ts'), 'utf8');
      else if (file.endsWith('.ts') && /template:\s*`[\s\S]*?<select\b/.test(source)) owner = source;
      if (owner !== null && !/imports:\s*\[[^\]]*SelectDropdownDirective/.test(owner)) missing.push(relative(APP_DIR, file));
    }
    assert.deepEqual(missing, []);
  });
});
