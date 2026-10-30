import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DOCUMENT_OWNER_ROLES, documentVisibleWhere } from './document-access.service';
import { documentMime } from './file-signature';
import {
  OWNER_DOCUMENT_CATEGORIES,
  type OwnerDocumentCategory,
  type OwnerDocumentFileType,
  type OwnerDocumentsQueryDto,
} from './dto/owner-documents.dto';

/** Category of a document = the template folder at the root of its folder chain (L2). */
const CATEGORY_BY_ROOT_KEY: Record<string, OwnerDocumentCategory> = {
  actas: 'actas',
  contabilidad: 'economicos',
  legal: 'normativa',
  seguros: 'seguros',
  contratos: 'contratos',
};

/** Names the owner sees on the chips; `q` also matches them. */
export const OWNER_CATEGORY_LABELS: Record<OwnerDocumentCategory, string> = {
  actas: 'Actas',
  economicos: 'Económicos',
  normativa: 'Normativa',
  seguros: 'Seguros',
  contratos: 'Contratos',
  otros: 'Otros',
};

const PREVIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
const SPREADSHEETS = new Set(['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']);
const TEXT_DOCUMENTS = new Set(['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']);

export function fileTypeOf(mime: string | null): OwnerDocumentFileType {
  if (!mime) return 'other';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (SPREADSHEETS.has(mime)) return 'spreadsheet';
  if (TEXT_DOCUMENTS.has(mime)) return 'document';
  return 'other';
}

/** Lower case without accents, so «economicos» finds «Económicos». */
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

export interface OwnerDocument {
  id: string;
  title: string;
  description: string | null;
  category: OwnerDocumentCategory;
  date: string;
  size: string;
  sizeBytes: number | null;
  mimeType: string | null;
  fileType: OwnerDocumentFileType;
  previewable: boolean;
  isNew: boolean;
  board: boolean;
  publishedBy: 'Administración de la comunidad' | 'Generado por Domora';
  estateId: string;
  estateName: string;
}

export type OwnerDocumentCounts = Record<'all' | OwnerDocumentCategory, number>;

/**
 * «Documentación» of the signed-in owner (odd/tasks/owner-documents.md, T0): the same library the
 * manager runs, read through the single visibility rule (`documentVisibleWhere`). Every filter,
 * count and read marker works inside that visible set.
 */
@Injectable()
export class OwnerDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthenticatedUser, query: OwnerDocumentsQueryDto): Promise<{ items: OwnerDocument[]; counts: OwnerDocumentCounts }> {
    const visible = await documentVisibleWhere(this.prisma, user);
    const conditions: Prisma.DocumentWhereInput[] = [visible, { estateId: { not: null } }];
    if (query.propertyId) conditions.push(await this.propertyScope(user, query.propertyId));
    if (query.from) conditions.push({ date: { gte: new Date(`${query.from}T00:00:00.000Z`) } });
    if (query.to) conditions.push({ date: { lte: new Date(`${query.to}T00:00:00.000Z`) } });

    const [rows, reads] = await Promise.all([
      this.prisma.document.findMany({
        where: { AND: conditions },
        select: {
          id: true, title: true, description: true, date: true, size: true, sizeBytes: true, mimeType: true, s3Key: true,
          folderId: true, estateId: true, source: true, effectiveVisibility: true, estate: { select: { name: true } },
        },
      }),
      this.readIds(user.id),
    ]);
    const categoryOf = await this.categoryResolver(rows);

    const q = query.q?.trim() ? fold(query.q.trim()) : null;
    const filtered = rows
      .map((d): OwnerDocument => {
        const mimeType = documentMime(d);
        return {
          id: d.id,
          title: d.title,
          description: d.description,
          category: categoryOf(d.folderId),
          date: d.date.toISOString().slice(0, 10),
          size: d.size,
          sizeBytes: d.sizeBytes,
          mimeType,
          fileType: fileTypeOf(mimeType),
          previewable: !!mimeType && PREVIEWABLE.has(mimeType),
          isNew: !reads.has(d.id),
          board: d.effectiveVisibility === 'BOARD',
          publishedBy: d.source === 'generated' ? 'Generado por Domora' : 'Administración de la comunidad',
          estateId: d.estateId!,
          estateName: d.estate?.name ?? '',
        };
      })
      .filter((d) => !q || [d.title, d.description ?? '', OWNER_CATEGORY_LABELS[d.category]].some((text) => fold(text).includes(q)))
      .filter((d) => !query.fileType || d.fileType === query.fileType)
      .filter((d) => !query.onlyNew || d.isNew);

    // G10: the chips count what every other filter leaves, never anything outside the visible set.
    const counts = Object.fromEntries([['all', filtered.length], ...OWNER_DOCUMENT_CATEGORIES.map((c) => [c, 0])]) as OwnerDocumentCounts;
    for (const d of filtered) counts[d.category] += 1;

    const items = filtered.filter((d) => !query.category || d.category === query.category);
    return { items: items.sort(comparator(query.sort ?? 'date_desc')), counts };
  }

  /** Marks as read the given documents the owner can see; the rest are ignored silently. */
  async markRead(user: AuthenticatedUser, documentIds: string[]): Promise<{ marked: number }> {
    const ids = [...new Set(documentIds)];
    if (!ids.length) return { marked: 0 };
    const visible = await documentVisibleWhere(this.prisma, user);
    const allowed = await this.prisma.document.findMany({ where: { AND: [visible, { id: { in: ids } }] }, select: { id: true } });
    if (!allowed.length) return { marked: 0 };
    const readAt = new Date();
    const { count } = await this.prisma.resourceRead.createMany({
      data: allowed.map((d) => ({ userId: user.id, sourceType: 'document' as const, sourceId: d.id, readAt })),
      skipDuplicates: true,
    });
    return { marked: count };
  }

  /**
   * One of the owner's properties (linked, not revoked, owner role, alive): its estate's documents
   * except the ones addressed to another property. Anything else answers 404.
   */
  private async propertyScope(user: AuthenticatedUser, propertyId: string): Promise<Prisma.DocumentWhereInput> {
    const membership = await this.prisma.propertyMembership.findFirst({
      where: {
        userId: user.id, propertyId, status: 'linked', revokedAt: null, roleType: { in: [...DOCUMENT_OWNER_ROLES] },
        property: { deletedAt: null, estate: { deletedAt: null } },
      },
      select: { property: { select: { estateId: true } } },
    });
    const estateId = membership?.property.estateId;
    if (!estateId) throw new NotFoundException('Propiedad no encontrada.');
    return { estateId, OR: [{ targetPropertyId: null }, { targetPropertyId: propertyId }] };
  }

  private async readIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.resourceRead.findMany({ where: { userId, sourceType: 'document' }, select: { sourceId: true } });
    return new Set(rows.map((r) => r.sourceId));
  }

  /** Category of a folder: walks up to its root and maps the template key; anything else is «Otros». */
  private async categoryResolver(rows: { folderId: string | null; estateId: string | null }[]): Promise<(folderId: string | null) => OwnerDocumentCategory> {
    const estateIds = [...new Set(rows.filter((r) => r.folderId).map((r) => r.estateId!))];
    const folders = estateIds.length
      ? await this.prisma.documentFolder.findMany({ where: { estateId: { in: estateIds } }, select: { id: true, parentId: true, systemKey: true } })
      : [];
    const byId = new Map(folders.map((f) => [f.id, f]));
    const memo = new Map<string, OwnerDocumentCategory>();
    return (folderId) => {
      if (!folderId) return 'otros';
      const cached = memo.get(folderId);
      if (cached) return cached;
      const seen = new Set<string>();
      let folder = byId.get(folderId);
      while (folder?.parentId && !seen.has(folder.id)) {
        seen.add(folder.id);
        folder = byId.get(folder.parentId);
      }
      // A cycle (prevented by the library) or a missing folder falls back to «Otros».
      const category = folder && !folder.parentId ? CATEGORY_BY_ROOT_KEY[folder.systemKey ?? ''] ?? 'otros' : 'otros';
      memo.set(folderId, category);
      return category;
    };
  }
}

function comparator(sort: NonNullable<OwnerDocumentsQueryDto['sort']>): (a: OwnerDocument, b: OwnerDocument) => number {
  const byName = (a: OwnerDocument, b: OwnerDocument) => collator.compare(a.title, b.title);
  const byDateDesc = (a: OwnerDocument, b: OwnerDocument) => b.date.localeCompare(a.date) || byName(a, b);
  switch (sort) {
    case 'date_asc': return (a, b) => a.date.localeCompare(b.date) || byName(a, b);
    case 'name_asc': return (a, b) => byName(a, b) || byDateDesc(a, b);
    // Unknown sizes go last.
    case 'size_desc': return (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) || byDateDesc(a, b);
    default: return byDateDesc;
  }
}
