import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Guarda de código: la finca de una incidencia es `Issue.estateId`. Una consulta de incidencias que filtre por
 * `property: { estateId … }` (o una SQL que cruce `issues` con `properties` para saber la finca) dejaría fuera, en silencio, las
 * incidencias de zonas comunes —que no tienen propiedad—. Todo filtro por finca pasa por `issues/issue-estate.ts`.
 */
const ROOT = join(__dirname, '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'testing') sources(path, out);
    } else if (/\.ts$/.test(entry.name) && !/\.spec\.ts$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/** El texto de la llamada que empieza en el `(` de `from`, hasta su `)` de cierre. */
function callText(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0)
      return source.slice(from, i + 1);
  }
  return source.slice(from);
}

describe('Issue.estateId es la única referencia de finca de una incidencia', () => {
  const files = sources(ROOT);
  const CALL =
    /\.issue\.(findMany|findFirst|findUnique|count|groupBy|aggregate)\(/g;

  it('ninguna consulta de incidencias filtra por property.estateId', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(CALL)) {
        const call = callText(source, match.index + match[0].length - 1);
        if (
          /property:\s*\{[^{}]*\bestateId\b/.test(call) ||
          /property:\s*inEstate/.test(call)
        )
          offenders.push(`${relative(ROOT, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('ninguna SQL deduce la finca de una incidencia cruzando issues con properties', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (/FROM\s+"?issues"?[\s\S]{0,200}JOIN\s+"?properties"?/i.test(source))
        offenders.push(relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it('la guarda funciona: reconoce el patrón que prohíbe', () => {
    const bad =
      'this.prisma.issue.findMany({ where: { property: { estateId } } })';
    const match = bad.match(/\.issue\.findMany\(/);
    expect(match).not.toBeNull();
    expect(
      /property:\s*\{[^{}]*\bestateId\b/.test(
        callText(bad, (match?.index ?? 0) + 'issue.findMany'.length + 1),
      ),
    ).toBe(true);
  });
});
