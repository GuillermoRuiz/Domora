import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  OWNER_ALERTS_LINK,
  OWNER_HOME_LINK,
  OWNER_LINK_ROUTES,
  OWNER_MESSAGES_LINK,
  ownerDocumentsLink,
  ownerEstateSectionLink,
  ownerIssueLink,
  ownerMeetingsLink,
  ownerPropertyLink,
  ownerReceiptsLink,
} from './owner-links';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'generated' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Ruta del enlace sin query, y `/c/properties/:id` como `/c/properties`. */
function routeOf(link: string): string {
  const path = link.split('?')[0];
  return path.startsWith('/c/properties/') ? '/c/properties' : path;
}

describe('enlaces del portal del propietario (contrato)', () => {
  it('ningún fichero fuera de owner-links.ts escribe un enlace /c/… a mano', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.endsWith(join('common', 'owner-links.ts')))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => /['"`]\/c\//.test(line))
          .map(({ i }) => `${relative(SRC, file)}:${i + 1}`),
      );
    expect(offenders).toEqual([]);
  });

  it('cada enlace que construye owner-links lleva a una ruta conocida del portal', () => {
    const links = [
      OWNER_HOME_LINK,
      OWNER_MESSAGES_LINK,
      OWNER_ALERTS_LINK,
      ownerPropertyLink('p1', 'communications'),
      ownerReceiptsLink('p1', 'r1'),
      ownerMeetingsLink('e1', 'm1'),
      ownerEstateSectionLink('e1', 'reservas'),
      ownerIssueLink('i1'),
      ownerDocumentsLink('d1'),
    ];
    for (const link of links) {
      expect(OWNER_LINK_ROUTES).toContain(routeOf(link));
    }
  });
});
