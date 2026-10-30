import type { LibraryFolder } from '../../../core/document-library.service';

export interface FolderOption { id: string | null; label: string; depth: number }

/** Folders in tree order (siblings keep the server order). */
export function folderTree(folders: LibraryFolder[]): (LibraryFolder & { depth: number })[] {
  const out: (LibraryFolder & { depth: number })[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of folders.filter(x => x.parentId === parentId)) {
      out.push({ ...f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Ids of `folderId` and every folder below it. */
export function subtreeIds(folders: LibraryFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return ids;
}

/** Destination choices for a select; `exclude` drops a folder and its subtree (a folder cannot move into itself). */
export function folderOptions(folders: LibraryFolder[], options: { root?: string; exclude?: string } = {}): FolderOption[] {
  const excluded = options.exclude ? subtreeIds(folders, options.exclude) : new Set<string>();
  const list: FolderOption[] = options.root ? [{ id: null, label: options.root, depth: 0 }] : [];
  for (const f of folderTree(folders)) {
    if (excluded.has(f.id)) continue;
    list.push({ id: f.id, label: `${'   '.repeat(f.depth)}${f.name}`, depth: f.depth });
  }
  return list;
}

/** Root → folder path, for breadcrumbs. */
export function folderPath(folders: LibraryFolder[], folderId: string | null): LibraryFolder[] {
  const byId = new Map(folders.map(f => [f.id, f]));
  const path: LibraryFolder[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  while (current && path.length < 50) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Spanish label of a file kind, from its mime type or extension. */
export function fileKind(mimeType: string | null, title = ''): string {
  const mime = mimeType ?? '';
  const ext = title.split('.').pop()?.toLowerCase() ?? '';
  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF';
  if (mime.startsWith('image/')) return 'Imagen';
  if (mime.includes('wordprocessingml') || mime === 'application/msword' || ext === 'docx' || ext === 'doc') return 'Word';
  if (mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel' || ext === 'xlsx' || ext === 'xls') return 'Excel';
  if (mime.startsWith('text/') || ext === 'txt') return 'Texto';
  return 'Fichero';
}

export const PREVIEWABLE = (mimeType: string | null) => mimeType === 'application/pdf' || (mimeType ?? '').startsWith('image/');
