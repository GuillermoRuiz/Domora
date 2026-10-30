#!/usr/bin/env node
/**
 * T0.20 — Control de CI del bundle: el build de PRODUCCIÓN no debe contener
 * rastro del modo demo (texto, credenciales, dominio de las cuentas) y el build
 * DEMO sí debe contenerlo (si no, el fileReplacements se rompió en silencio).
 *
 * Por qué existe: esbuild NO elimina ese código con flags ni con import()
 * dinámico (spike T0.5), así que la garantía real es (1) el fileReplacements de
 * src/app/demo/demo-ui.ts y (2) este grep sobre el resultado.
 *
 * Uso:
 *   ng build --configuration production && node scripts/check-demo-bundle.mjs prod
 *   ng build --configuration demo --output-path dist/demo && node scripts/check-demo-bundle.mjs demo dist/demo/browser
 *
 * Sin directorio explícito usa dist/domora-app/browser. Sale con código 1 si
 * hay violaciones (y las lista con fichero y patrón), 2 si el uso es inválido
 * o el directorio no existe / está vacío. No depende de ripgrep: solo Node.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DIST = 'dist/domora-app/browser';

/** Ficheros de texto del bundle que se inspeccionan (el resto: imágenes, fuentes, etc.). */
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.json', '.txt', '.webmanifest', '.map']);

/** Lo que NO puede aparecer en el bundle de producción. */
export const PROD_FORBIDDEN = [
  { name: 'texto "Modo demo"', re: /Modo demo/i },
  { name: 'texto "Entorno de demostración"', re: /Entorno de demostraci/i },
  { name: 'credencial owner123', re: /owner123/ },
  { name: 'credencial admin123', re: /admin123/ },
  { name: 'credencial super123', re: /super123/ },
  { name: 'credencial Demo2026!', re: /Demo2026!/ },
  { name: 'cuenta superadmin@', re: /superadmin@/i },
  { name: 'cuenta admin@domora', re: /admin@domora/i },
  { name: 'dominio de cuentas demo', re: /demo\.domora/i },
];

/** Lo que DEBE aparecer en el bundle demo (al menos una vez en total). */
export const DEMO_REQUIRED = [
  { name: 'cuentas @demo.domora.app', re: /@demo\.domora\.app/ },
  { name: 'texto "Modo demo"', re: /Modo demo/ },
  { name: 'texto "Entorno de demostración"', re: /Entorno de demostraci/ },
];

/** Lo que NO puede aparecer ni siquiera en el bundle demo (credenciales del seed de CI/dev). */
export const DEMO_FORBIDDEN = [
  { name: 'credencial owner123', re: /owner123/ },
  { name: 'credencial admin123', re: /admin123/ },
  { name: 'credencial super123', re: /super123/ },
  { name: 'cuenta admin@domora', re: /admin@domora/i },
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) yield full;
  }
}

/**
 * @param {string} dir directorio del bundle (donde está index.html)
 * @param {'prod'|'demo'} mode
 * @returns {{ ok: boolean, filesScanned: number, violations: string[] }}
 */
export function checkBundle(dir, mode) {
  const forbidden = mode === 'prod' ? PROD_FORBIDDEN : DEMO_FORBIDDEN;
  const required = mode === 'demo' ? DEMO_REQUIRED : [];
  const violations = [];
  const seen = new Set();
  let filesScanned = 0;

  for (const file of walk(dir)) {
    filesScanned++;
    const text = readFileSync(file, 'utf8');
    const rel = relative(dir, file);
    for (const { name, re } of forbidden) {
      if (re.test(text)) violations.push(`${rel}: contiene ${name} (prohibido en el bundle ${mode})`);
    }
    for (const { name, re } of required) {
      if (re.test(text)) seen.add(name);
    }
  }
  for (const { name } of required) {
    if (!seen.has(name)) violations.push(`bundle demo: no se encontró ${name} (¿se rompió el fileReplacements?)`);
  }
  return { ok: violations.length === 0 && filesScanned > 0, filesScanned, violations };
}

function main(argv) {
  const [mode, dir = DEFAULT_DIST] = argv;
  if (mode !== 'prod' && mode !== 'demo') {
    console.error('Uso: node scripts/check-demo-bundle.mjs <prod|demo> [directorio-del-bundle]');
    return 2;
  }
  let result;
  try {
    result = checkBundle(dir, mode);
  } catch (err) {
    console.error(`No se pudo leer "${dir}": ${err.message}`);
    return 2;
  }
  if (result.filesScanned === 0) {
    console.error(`"${dir}" no contiene ficheros de texto del bundle: ¿se hizo el build?`);
    return 2;
  }
  if (!result.ok) {
    console.error(`FALLO check-demo-bundle (${mode}) en ${dir}:`);
    for (const v of result.violations) console.error(`  - ${v}`);
    return 1;
  }
  console.log(`OK check-demo-bundle (${mode}): ${result.filesScanned} ficheros revisados en ${dir}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
