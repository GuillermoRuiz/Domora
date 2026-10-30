import type { DocumentVisibility } from '../../../src/prisma/client';
import { LibraryService, SYSTEM_FOLDERS } from '../../../src/documents/library.service';
import type { DemoCtx } from '../context';

export type SystemFolderKey = (typeof SYSTEM_FOLDERS)[number]['key'];

/** Where a seeded document lives in the library and who sees it (null = inherits its folder). */
export interface Filing { folder: SystemFolderKey; visibility: DocumentVisibility | null }

/**
 * Files documents created by `ResourcesService.createDocument` (which has no folder, mime type
 * or visibility) into the estate library, then lets `LibraryService` recompute the effective
 * visibility and send owners ONE grouped notice — as a manager filing a batch would.
 * Folder-level visibility goes in `folders` (system folders start as «Solo gestora»).
 */
export async function fileInLibrary(
  ctx: DemoCtx,
  estateId: string,
  documents: { id: string; filing: Filing; sizeBytes: number }[],
  folders: Partial<Record<SystemFolderKey, DocumentVisibility>> = {},
): Promise<void> {
  const { prisma } = ctx;
  const library = ctx.app.get(LibraryService, { strict: false });
  await library.ensureTemplate(estateId);
  const rows = await prisma.documentFolder.findMany({ where: { estateId, systemKey: { not: null } }, select: { id: true, systemKey: true } });
  const folderId = (key: SystemFolderKey) => {
    const row = rows.find((r) => r.systemKey === key);
    if (!row) throw new Error(`Biblioteca: falta la carpeta de sistema «${key}» en ${estateId}.`);
    return row.id;
  };
  for (const [key, visibility] of Object.entries(folders) as [SystemFolderKey, DocumentVisibility][]) {
    await prisma.documentFolder.update({ where: { id: folderId(key) }, data: { visibility } });
  }
  for (const doc of documents) {
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        folderId: folderId(doc.filing.folder), visibility: doc.filing.visibility,
        mimeType: 'application/pdf', sizeBytes: doc.sizeBytes, uploadedByUserId: ctx.actors.gestora.id,
      },
    });
  }
  const opened = await library.recompute(estateId);
  await library.announce(estateId, opened);
}
