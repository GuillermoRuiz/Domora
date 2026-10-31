import type { DocumentVisibility } from '../prisma/client';

export interface FolderNode {
  id: string;
  parentId: string | null;
  visibility: DocumentVisibility | null;
  systemKey?: string | null;
}
export interface DocumentNode {
  id: string;
  folderId: string | null;
  visibility: DocumentVisibility | null;
  effectiveVisibility: DocumentVisibility;
}

/** S7: anything not explicitly opened is «Solo gestora». */
export const DEFAULT_VISIBILITY: DocumentVisibility = 'MANAGER';

/** Template folder whose whole subtree is always «Solo gestora» (G2, odd/tasks/owner-documents.md). */
export const MANAGER_ONLY_SYSTEM_KEY = 'interno';

/**
 * Folders that can never be opened: the «Interno de la gestora» template folder and everything
 * under it, whatever visibility they store. A folder whose chain is broken or cyclic is not locked
 * by this (it resolves to MANAGER through `folderVisibilities` anyway).
 */
export function managerOnlyFolderIds(folders: FolderNode[]): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const memo = new Map<string, boolean>();
  const locked = (id: string, seen: Set<string>): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const folder = byId.get(id);
    if (!folder || seen.has(id)) return false;
    seen.add(id);
    const value = folder.parentId
      ? locked(folder.parentId, seen)
      : folder.systemKey === MANAGER_ONLY_SYSTEM_KEY;
    memo.set(id, value);
    return value;
  };
  return new Set(
    folders.filter((f) => locked(f.id, new Set())).map((f) => f.id),
  );
}

/**
 * Effective visibility of every folder: its own, else its parent's, up to the root (MANAGER).
 * Cycles (which the service prevents) resolve to MANAGER instead of looping.
 */
export function folderVisibilities(
  folders: FolderNode[],
): Map<string, DocumentVisibility> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const memo = new Map<string, DocumentVisibility>();
  for (const id of managerOnlyFolderIds(folders))
    memo.set(id, DEFAULT_VISIBILITY);
  const resolve = (id: string, seen: Set<string>): DocumentVisibility => {
    const cached = memo.get(id);
    if (cached) return cached;
    const folder = byId.get(id);
    if (!folder || seen.has(id)) return DEFAULT_VISIBILITY;
    seen.add(id);
    const value =
      folder.visibility ??
      (folder.parentId ? resolve(folder.parentId, seen) : DEFAULT_VISIBILITY);
    memo.set(id, value);
    return value;
  };
  for (const f of folders) resolve(f.id, new Set());
  return memo;
}

/**
 * A document's own visibility wins; otherwise it inherits its folder's (MANAGER at the root).
 * Inside a manager-only folder (G2) it is always MANAGER.
 */
export function documentEffectiveVisibility(
  doc: Pick<DocumentNode, 'folderId' | 'visibility'>,
  folders: Map<string, DocumentVisibility>,
  managerOnly: Set<string> = new Set(),
): DocumentVisibility {
  if (doc.folderId && managerOnly.has(doc.folderId)) return DEFAULT_VISIBILITY;
  if (doc.visibility) return doc.visibility;
  return (doc.folderId && folders.get(doc.folderId)) || DEFAULT_VISIBILITY;
}

/** Documents whose stored effective visibility is out of date, grouped by the value they must get. */
export function staleEffectiveVisibilities(
  docs: DocumentNode[],
  folders: FolderNode[],
): Map<DocumentVisibility, string[]> {
  const effective = folderVisibilities(folders);
  const managerOnly = managerOnlyFolderIds(folders);
  const out = new Map<DocumentVisibility, string[]>();
  for (const doc of docs) {
    const next = documentEffectiveVisibility(doc, effective, managerOnly);
    if (next !== doc.effectiveVisibility)
      out.set(next, [...(out.get(next) ?? []), doc.id]);
  }
  return out;
}

/** True when `candidateParentId` is `folderId` itself or one of its descendants (moving there would create a cycle). */
export function wouldCreateCycle(
  folderId: string,
  candidateParentId: string | null,
  folders: FolderNode[],
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let cursor = candidateParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === folderId || seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

/** Visible to owners in some way (used to notify on publication). */
export const isOwnerFacing = (v: DocumentVisibility) =>
  v === 'OWNERS' || v === 'PROPERTY';
