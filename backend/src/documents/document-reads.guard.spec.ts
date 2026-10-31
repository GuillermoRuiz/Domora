import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Guard against leaks: every file that READS `Document` rows must apply the library
 * visibility rule (`documentVisibleWhere`) or be staff-only for a stated reason.
 * A new reader fails this test until it is reviewed and listed here.
 */
const REVIEWED_READERS: Record<string, string> = {
  'documents/library.service.ts':
    'applies documentVisibleWhere; management paths require A/B',
  'documents/document-access.service.ts': 'defines the rule',
  'documents/owner-documents.service.ts':
    'applies documentVisibleWhere (owner «Documentación» list, counts, read markers)',
  'assistant/rag-authorization.service.ts':
    'applies documentVisibleWhere (downloads, uploads, assistant)',
  'resources/resources.service.ts':
    'applies documentVisibleWhere (list, alerts, activity)',
  'properties/property-overview.service.ts':
    'applies documentVisibleWhere (owner KPI)',
  'files/files.controller.ts':
    'download checks authorized_document_ids from RagAuthorizationService',
  'assistant/assistant.service.ts': 'A/B-only indexing by id',
  'agenda-tasks/agenda-task-links.service.ts': 'staff-only task links',
  'estates/estate-general.service.ts':
    'staff-only general data (governance.authorize)',
};

const READ =
  /\.document\.(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|groupBy|aggregate)\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    // The generated Prisma client documents the API, it does not read data.
    if (statSync(full).isDirectory())
      return name === 'generated' ? [] : sources(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

describe('Document reads apply the visibility rule', () => {
  it('only reviewed files read documents', () => {
    const root = path.join(__dirname, '..');
    const readers = sources(root)
      .filter((file) => READ.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
      .sort();
    expect(readers.filter((file) => !(file in REVIEWED_READERS))).toEqual([]);
  });

  it('the readers that claim to apply the rule really reference it', () => {
    const root = path.join(__dirname, '..');
    for (const [file, why] of Object.entries(REVIEWED_READERS)) {
      if (!why.startsWith('applies')) continue;
      expect(readFileSync(path.join(root, file), 'utf8')).toContain(
        'documentVisibleWhere',
      );
    }
  });
});
