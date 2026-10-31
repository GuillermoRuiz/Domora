import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DocumentVisibility, Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DOCUMENT_OWNER_ROLES } from './document-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { documentVisibleWhere } from './document-access.service';
import {
  folderVisibilities,
  isOwnerFacing,
  managerOnlyFolderIds,
  MANAGER_ONLY_SYSTEM_KEY,
  staleEffectiveVisibilities,
  wouldCreateCycle,
} from './document-visibility';
import { documentMime, fileMatchesMime } from './file-signature';
import type {
  CreateFolderDto,
  LibraryQueryDto,
  UpdateDocumentDto,
  UpdateFolderDto,
  UploadDocumentDto,
} from './dto/library.dto';
import { ownerDocumentsLink } from '../common/owner-links';

type Tx = Prisma.TransactionClient;

/** Template folders (D3), created for every estate; all «Solo gestora» (S7). */
export const SYSTEM_FOLDERS = [
  { key: 'legal', name: 'Documentación legal' },
  { key: 'actas', name: 'Actas y juntas' },
  { key: 'contabilidad', name: 'Contabilidad y presupuestos' },
  { key: 'seguros', name: 'Seguros' },
  { key: 'contratos', name: 'Contratos y mantenimiento' },
  { key: 'certificados', name: 'Certificados e inspecciones' },
  { key: 'interno', name: 'Interno de la gestora' },
] as const;

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const meetingRef = (meetingId: string) => `meeting:${meetingId}`;

/** G2: what «Interno de la gestora» answers to any attempt to open it or what it holds. */
export const MANAGER_ONLY_FOLDER_MESSAGE =
  'La carpeta «Interno de la gestora» es solo para la gestora: ni ella ni lo que contiene se puede abrir a los propietarios ni a la junta.';

/** Any visibility other than «Solo gestora» (null = inherit, which inside interno is MANAGER). */
const opens = (visibility: DocumentVisibility | null | undefined) =>
  !!visibility && visibility !== 'MANAGER';

/**
 * The estate document library: folders with inherited visibility, uploaded and
 * generated documents, trash and review of documents hidden by the migration.
 * Who may READ a document is decided only by `documentVisibleWhere`.
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly authorization: RagAuthorizationService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Authorization ────────────────────────────────────────────────────
  /** Manager (A/B) of this estate, checked against the database. */
  private async manager(
    estateId: string,
    user: AuthenticatedUser,
  ): Promise<string> {
    const context = await this.authorization.resolve(user, estateId, true);
    return context.allowed_community_ids[0];
  }

  private async reader(estateId: string, user: AuthenticatedUser) {
    const context = await this.authorization.resolve(user, estateId);
    return {
      estateId: context.allowed_community_ids[0],
      isManager: context.role !== 'C',
    };
  }

  // ── Template and visibility ──────────────────────────────────────────
  async ensureTemplate(
    estateId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<void> {
    await db.documentFolder.createMany({
      data: SYSTEM_FOLDERS.map((f, i) => ({
        estateId,
        name: f.name,
        systemKey: f.key,
        visibility: 'MANAGER' as const,
        sortOrder: i + 1,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Brings every document's stored effective visibility up to date. Returns the documents that
   * have just become visible to owners (to notify them).
   */
  async recompute(
    estateId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<string[]> {
    const [folders, docs] = await Promise.all([
      db.documentFolder.findMany({
        where: { estateId, deletedAt: null },
        select: { id: true, parentId: true, visibility: true, systemKey: true },
      }),
      db.document.findMany({
        where: { estateId },
        select: {
          id: true,
          folderId: true,
          visibility: true,
          effectiveVisibility: true,
        },
      }),
    ]);
    const stale = staleEffectiveVisibilities(docs, folders);
    const before = new Map(docs.map((d) => [d.id, d.effectiveVisibility]));
    const opened: string[] = [];
    for (const [value, ids] of stale) {
      await db.document.updateMany({
        where: { id: { in: ids } },
        data: { effectiveVisibility: value },
      });
      if (isOwnerFacing(value))
        opened.push(...ids.filter((id) => !isOwnerFacing(before.get(id)!)));
    }
    return opened;
  }

  /**
   * Tells the owners about documents just opened to them: one notice per person,
   * after the change is committed, and never failing the operation that opened them.
   */
  async announce(estateId: string, openedIds: string[]): Promise<void> {
    if (!openedIds.length) return;
    try {
      const docs = await this.prisma.document.findMany({
        where: {
          id: { in: openedIds },
          estateId,
          deletedAt: null,
          effectiveVisibility: { in: ['OWNERS', 'PROPERTY'] },
        },
        select: {
          id: true,
          title: true,
          effectiveVisibility: true,
          targetPropertyId: true,
        },
      });
      if (!docs.length) return;
      const owners = await this.prisma.propertyMembership.findMany({
        where: {
          status: 'linked',
          revokedAt: null,
          roleType: { in: [...DOCUMENT_OWNER_ROLES] },
          property: { estateId, deletedAt: null },
        },
        select: { userId: true, propertyId: true },
      });
      const docsFor = new Map<string, { id: string; title: string }[]>();
      for (const doc of docs) {
        const recipients =
          doc.effectiveVisibility === 'OWNERS'
            ? owners
            : owners.filter((o) => o.propertyId === doc.targetPropertyId);
        for (const userId of new Set(recipients.map((r) => r.userId)))
          docsFor.set(userId, [
            ...(docsFor.get(userId) ?? []),
            { id: doc.id, title: doc.title },
          ]);
      }
      // Group people who get the same set, so each notice names exactly their documents.
      const groups = new Map<string, string[]>();
      for (const [userId, entries] of docsFor) {
        const key = JSON.stringify(entries);
        groups.set(key, [...(groups.get(key) ?? []), userId]);
      }
      for (const [key, userIds] of groups) {
        const entries = JSON.parse(key) as { id: string; title: string }[];
        const titles = entries.map((e) => e.title);
        await this.notifications.notify({
          // One document opens it in «Documentación»; several land on the page.
          userIds,
          category: 'document',
          estateId,
          link: ownerDocumentsLink(entries.length === 1 ? entries[0].id : null),
          title:
            titles.length === 1
              ? `Nuevo documento: ${titles[0]}`
              : `${titles.length} documentos nuevos de tu comunidad`,
          body: titles.length === 1 ? null : titles.slice(0, 5).join(' · '),
        });
      }
    } catch {
      // A notice that fails must not undo the publication (NotificationsService.notify never throws either).
    }
  }

  // ── Reading ──────────────────────────────────────────────────────────
  async list(
    estateIdParam: string,
    user: AuthenticatedUser,
    query: LibraryQueryDto,
  ) {
    const { estateId, isManager } = await this.reader(estateIdParam, user);
    if (query.view && !isManager)
      throw new ForbiddenException(
        'Solo la gestora ve la papelera y la revisión.',
      );
    await this.ensureTemplate(estateId);
    const visible = await documentVisibleWhere(this.prisma, user);
    const folders = await this.prisma.documentFolder.findMany({
      where: { estateId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const effective = folderVisibilities(folders);

    let where: Prisma.DocumentWhereInput;
    if (query.view === 'trash') {
      where = { estateId, deletedAt: { not: null } };
    } else {
      const scope: Prisma.DocumentWhereInput =
        query.view === 'review'
          ? { visibilityReviewPending: true }
          : query.q?.trim()
            ? {
                OR: ['title', 'type', 'description'].map((field) => ({
                  [field]: {
                    contains: query.q!.trim(),
                    mode: 'insensitive' as const,
                  },
                })),
              }
            : {
                folderId:
                  !query.folderId || query.folderId === 'root'
                    ? null
                    : query.folderId,
              };
      where = { AND: [{ estateId }, visible, scope] };
    }
    const [
      documents,
      visibleByFolder,
      ownerFacingByFolder,
      reads,
      pendingReview,
      inTrash,
    ] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: [{ date: 'desc' }, { title: 'asc' }],
      }),
      this.prisma.document.groupBy({
        by: ['folderId'],
        where: { AND: [{ estateId }, visible] },
        _count: { _all: true },
      }),
      // For the manager's «Ver como propietario»: what owners can see in each folder.
      isManager
        ? this.prisma.document.groupBy({
            by: ['folderId'],
            where: {
              estateId,
              deletedAt: null,
              effectiveVisibility: { in: ['OWNERS', 'PROPERTY'] },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      isManager ? Promise.resolve(new Set<string>()) : this.readIds(user.id),
      isManager
        ? this.prisma.document.count({
            where: { estateId, deletedAt: null, visibilityReviewPending: true },
          })
        : 0,
      isManager
        ? this.prisma.document.count({
            where: { estateId, deletedAt: { not: null } },
          })
        : 0,
    ]);

    // Documents per folder including subfolders; owners only see folders that hold something for them.
    const direct = new Map(
      visibleByFolder.map((g) => [g.folderId, g._count._all]),
    );
    const ownerDirect = new Map(
      ownerFacingByFolder.map((g) => [g.folderId, g._count._all]),
    );
    const childrenOf = (id: string) => folders.filter((f) => f.parentId === id);
    const subtree = (counts: Map<string | null, number>) => {
      const sum = (id: string): number =>
        (counts.get(id) ?? 0) +
        childrenOf(id).reduce((acc, c) => acc + sum(c.id), 0);
      return sum;
    };
    const total = subtree(direct);
    const ownerTotal = subtree(ownerDirect);
    const shownFolders = folders.filter((f) => isManager || total(f.id) > 0);

    return {
      folders: shownFolders.map((f) => ({
        id: f.id,
        parentId: f.parentId,
        name: f.name,
        systemKey: f.systemKey,
        ...(isManager
          ? {
              visibility: f.visibility,
              effectiveVisibility: effective.get(f.id),
              ownerDocumentCount: ownerTotal(f.id),
            }
          : {}),
        documentCount: total(f.id),
      })),
      rootDocumentCount: direct.get(null) ?? 0,
      ...(isManager
        ? { rootOwnerDocumentCount: ownerDirect.get(null) ?? 0 }
        : {}),
      documents: documents.map((d) =>
        isManager ? this.managerView(d) : this.ownerView(d, reads),
      ),
      ...(isManager ? { pendingReview, inTrash } : {}),
    };
  }

  private async readIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.resourceRead.findMany({
      where: { userId, sourceType: 'document' },
      select: { sourceId: true },
    });
    return new Set(rows.map((r) => r.sourceId));
  }

  private baseView(d: Prisma.DocumentGetPayload<object>) {
    return {
      id: d.id,
      title: d.title,
      type: d.type,
      date: d.date,
      size: d.size,
      sizeBytes: d.sizeBytes,
      mimeType: documentMime(d),
      folderId: d.folderId,
      source: d.source,
      description: d.description,
      targetPropertyId: d.targetPropertyId,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  /** What the manager sees: visibility details, review flag and trash date. */
  private managerView(d: Prisma.DocumentGetPayload<object>) {
    return {
      ...this.baseView(d),
      visibility: d.visibility,
      effectiveVisibility: d.effectiveVisibility,
      visibilityReviewPending: d.visibilityReviewPending,
      deletedAt: d.deletedAt,
    };
  }

  /** What an owner sees: no visibility internals, plus whether it is new for them. */
  private ownerView(d: Prisma.DocumentGetPayload<object>, reads: Set<string>) {
    return { ...this.baseView(d), isNew: !reads.has(d.id) };
  }

  // ── Folders ──────────────────────────────────────────────────────────
  private async folderOf(
    estateId: string,
    folderId: string,
    db: Tx | PrismaService = this.prisma,
  ) {
    const folder = await db.documentFolder.findFirst({
      where: { id: folderId, estateId, deletedAt: null },
    });
    if (!folder) throw new BadRequestException('Carpeta ajena a la finca.');
    return folder;
  }

  /** Folders of the estate that can never be opened (G2): «Interno de la gestora» and its subtree. */
  private async managerOnlyFolders(
    estateId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<Set<string>> {
    const folders = await db.documentFolder.findMany({
      where: { estateId, deletedAt: null },
      select: { id: true, parentId: true, visibility: true, systemKey: true },
    });
    return managerOnlyFolderIds(folders);
  }

  async createFolder(
    estateIdParam: string,
    dto: CreateFolderDto,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    return this.prisma.$transaction(async (tx) => {
      await this.ensureTemplate(estateId, tx);
      if (dto.parentId) await this.folderOf(estateId, dto.parentId, tx);
      if (
        dto.parentId &&
        opens(dto.visibility) &&
        (await this.managerOnlyFolders(estateId, tx)).has(dto.parentId)
      ) {
        throw new BadRequestException(MANAGER_ONLY_FOLDER_MESSAGE);
      }
      await this.assertUniqueName(
        estateId,
        dto.parentId ?? null,
        dto.name,
        null,
        tx,
      );
      const folder = await tx.documentFolder.create({
        data: {
          estateId,
          parentId: dto.parentId ?? null,
          name: dto.name,
          visibility: dto.visibility ?? null,
          createdByUserId: user.id,
        },
      });
      return folder;
    });
  }

  private async assertUniqueName(
    estateId: string,
    parentId: string | null,
    name: string,
    exceptId: string | null,
    tx: Tx,
  ) {
    const clash = await tx.documentFolder.findFirst({
      where: {
        estateId,
        parentId,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(`Ya hay una carpeta «${name}» en ese lugar.`);
  }

  async updateFolder(
    estateIdParam: string,
    folderId: string,
    dto: UpdateFolderDto,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    const opened = await this.prisma.$transaction(async (tx) => {
      const folder = await this.folderOf(estateId, folderId, tx);
      if (dto.parentId !== undefined && folder.systemKey)
        throw new BadRequestException(
          'Las carpetas de la plantilla no se mueven.',
        );
      const parentId =
        dto.parentId === undefined ? folder.parentId : dto.parentId;
      if (dto.parentId) {
        await this.folderOf(estateId, dto.parentId, tx);
        const all = await tx.documentFolder.findMany({
          where: { estateId, deletedAt: null },
          select: { id: true, parentId: true, visibility: true },
        });
        if (wouldCreateCycle(folderId, dto.parentId, all))
          throw new BadRequestException(
            'Una carpeta no puede moverse dentro de sí misma.',
          );
      }
      if (opens(dto.visibility)) {
        const locked =
          folder.systemKey === MANAGER_ONLY_SYSTEM_KEY ||
          (!!parentId &&
            (await this.managerOnlyFolders(estateId, tx)).has(parentId));
        if (locked) throw new BadRequestException(MANAGER_ONLY_FOLDER_MESSAGE);
      }
      if (dto.name !== undefined || dto.parentId !== undefined) {
        await this.assertUniqueName(
          estateId,
          parentId,
          dto.name ?? folder.name,
          folderId,
          tx,
        );
      }
      await tx.documentFolder.update({
        where: { id: folderId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
          ...(dto.visibility !== undefined
            ? { visibility: dto.visibility }
            : {}),
        },
      });
      // A visibility decided on the folder also settles the review of the documents it holds.
      if (dto.visibility !== undefined) {
        await tx.document.updateMany({
          where: { estateId, folderId, visibility: null },
          data: { visibilityReviewPending: false },
        });
      }
      return this.recompute(estateId, tx);
    });
    await this.announce(estateId, opened);
    return { id: folderId, opened };
  }

  async deleteFolder(
    estateIdParam: string,
    folderId: string,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    await this.prisma.$transaction(async (tx) => {
      const folder = await this.folderOf(estateId, folderId, tx);
      if (folder.systemKey)
        throw new BadRequestException(
          'Las carpetas de la plantilla no se pueden eliminar.',
        );
      const [children, docs] = await Promise.all([
        tx.documentFolder.count({
          where: { parentId: folderId, deletedAt: null },
        }),
        tx.document.count({ where: { folderId, deletedAt: null } }),
      ]);
      if (children || docs)
        throw new ConflictException(
          'La carpeta no está vacía: mueve o elimina antes su contenido.',
        );
      await tx.documentFolder.update({
        where: { id: folderId },
        data: { deletedAt: new Date() },
      });
    });
    return { id: folderId, deleted: true };
  }

  // ── Documents ────────────────────────────────────────────────────────
  private async documentOf(
    estateId: string,
    documentId: string,
    db: Tx | PrismaService = this.prisma,
  ) {
    const doc = await db.document.findFirst({
      where: { id: documentId, estateId },
    });
    if (!doc)
      throw new NotFoundException('Documento no encontrado en esta finca.');
    return doc;
  }

  private async assertTargetProperty(
    estateId: string,
    propertyId: string,
    db: Tx | PrismaService,
  ) {
    const property = await db.property.findFirst({
      where: { id: propertyId, estateId, deletedAt: null },
      select: { id: true },
    });
    if (!property)
      throw new BadRequestException(
        'La propiedad de destino no pertenece a esta finca.',
      );
  }

  async upload(
    estateIdParam: string,
    file: UploadedFile | undefined,
    dto: UploadDocumentDto,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    if (!file)
      throw new BadRequestException(
        'No se recibió ningún fichero (campo "file").',
      );
    this.storage.assertAllowed(file.mimetype, file.size);
    if (!fileMatchesMime(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        'El contenido del fichero no corresponde a su tipo. Súbelo de nuevo desde el original.',
      );
    }
    const visibility = dto.targetPropertyId
      ? 'PROPERTY'
      : (dto.visibility ?? null);
    if (visibility === 'PROPERTY' && !dto.targetPropertyId)
      throw new BadRequestException(
        'Elige la propiedad que verá el documento.',
      );
    if (dto.targetPropertyId)
      await this.assertTargetProperty(
        estateId,
        dto.targetPropertyId,
        this.prisma,
      );
    if (dto.folderId) await this.folderOf(estateId, dto.folderId);
    if (
      dto.folderId &&
      opens(visibility) &&
      (await this.managerOnlyFolders(estateId)).has(dto.folderId)
    ) {
      throw new BadRequestException(MANAGER_ONLY_FOLDER_MESSAGE);
    }
    const s3Key = await this.storage.put(
      `documents/${estateId}`,
      file.originalname,
      file.buffer,
    );
    const { document, opened } = await this.prisma.$transaction(async (tx) => {
      await this.ensureTemplate(estateId, tx);
      const document = await tx.document.create({
        data: {
          estateId,
          title: dto.title?.trim() || file.originalname,
          type: dto.type?.trim() || 'Documento',
          date: new Date(),
          size: humanSize(file.size),
          sizeBytes: file.size,
          mimeType: file.mimetype,
          s3Key,
          folderId: dto.folderId ?? null,
          visibility,
          targetPropertyId: dto.targetPropertyId ?? null,
          description: dto.description?.trim() || null,
          uploadedByUserId: user.id,
        },
      });
      const opened = await this.recompute(estateId, tx);
      return {
        document: await tx.document.findUniqueOrThrow({
          where: { id: document.id },
        }),
        opened,
      };
    });
    await this.announce(estateId, opened);
    return { ...this.managerView(document), opened };
  }

  async updateDocument(
    estateIdParam: string,
    documentId: string,
    dto: UpdateDocumentDto,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    const result = await this.prisma.$transaction(async (tx) => {
      const doc = await this.documentOf(estateId, documentId, tx);
      if (doc.deletedAt)
        throw new ConflictException(
          'El documento está en la papelera: restáuralo primero.',
        );
      if (
        doc.source === 'generated' &&
        (dto.title !== undefined || dto.type !== undefined)
      ) {
        throw new BadRequestException(
          'Un documento generado por la aplicación no se renombra.',
        );
      }
      if (dto.folderId) await this.folderOf(estateId, dto.folderId, tx);
      let visibility =
        dto.visibility === undefined ? doc.visibility : dto.visibility;
      let closed = false;
      const finalFolderId =
        dto.folderId === undefined ? doc.folderId : dto.folderId;
      const managerOnly = finalFolderId
        ? await this.managerOnlyFolders(estateId, tx)
        : new Set<string>();
      if (finalFolderId && managerOnly.has(finalFolderId)) {
        // G2: nothing inside «Interno de la gestora» can be opened…
        if (opens(dto.visibility) || dto.targetPropertyId)
          throw new BadRequestException(MANAGER_ONLY_FOLDER_MESSAGE);
        // …and a document moved in drops whatever it was open to (moving it out later inherits as usual).
        if (
          dto.folderId &&
          doc.folderId !== dto.folderId &&
          !managerOnly.has(doc.folderId ?? '')
        ) {
          visibility = dto.visibility === 'MANAGER' ? 'MANAGER' : null;
          closed = true;
        }
      }
      const targetPropertyId =
        visibility === 'PROPERTY'
          ? dto.targetPropertyId === undefined
            ? doc.targetPropertyId
            : dto.targetPropertyId
          : null;
      if (visibility === 'PROPERTY' && !targetPropertyId)
        throw new BadRequestException(
          'Elige la propiedad que verá el documento.',
        );
      if (targetPropertyId && targetPropertyId !== doc.targetPropertyId)
        await this.assertTargetProperty(estateId, targetPropertyId, tx);
      await tx.document.update({
        where: { id: documentId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          visibility,
          targetPropertyId,
          // Closed in the same write: a PROPERTY effective visibility cannot outlive its target (DB check).
          ...(closed ? { effectiveVisibility: 'MANAGER' as const } : {}),
          // Deciding the visibility (or where it lives) is the review.
          ...(dto.visibility !== undefined || dto.folderId !== undefined
            ? { visibilityReviewPending: false }
            : {}),
        },
      });
      const opened = await this.recompute(estateId, tx);
      return {
        ...this.managerView(
          await tx.document.findUniqueOrThrow({ where: { id: documentId } }),
        ),
        opened,
      };
    });
    await this.announce(estateId, result.opened);
    return result;
  }

  async trash(
    estateIdParam: string,
    documentId: string,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    const doc = await this.documentOf(estateId, documentId);
    // Actas y documentos de junta se conservan durante la vida de la comunidad (doc/compliance/rgpd.md).
    if (doc.source === 'generated')
      throw new BadRequestException(
        'Un documento generado por la aplicación no se puede eliminar.',
      );
    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
    return { id: documentId, deleted: true };
  }

  async restore(
    estateIdParam: string,
    documentId: string,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    const doc = await this.documentOf(estateId, documentId);
    // Its folder may have been deleted meanwhile: it comes back to the root.
    const folderAlive = doc.folderId
      ? await this.prisma.documentFolder.count({
          where: { id: doc.folderId, deletedAt: null },
        })
      : 0;
    await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: {
          deletedAt: null,
          ...(doc.folderId && !folderAlive ? { folderId: null } : {}),
        },
      });
      await this.recompute(estateId, tx);
    });
    // Back from the trash into an open folder: the owners hear about it as if it were new.
    if (
      isOwnerFacing(
        (
          await this.prisma.document.findUniqueOrThrow({
            where: { id: documentId },
          })
        ).effectiveVisibility,
      )
    ) {
      await this.announce(estateId, [documentId]);
    }
    return { id: documentId, restored: true };
  }

  /** «Mantener solo para la gestora»: stops flagging documents hidden by the migration. */
  async markReviewed(
    estateIdParam: string,
    documentIds: string[],
    all: boolean,
    user: AuthenticatedUser,
  ) {
    const estateId = await this.manager(estateIdParam, user);
    const { count } = await this.prisma.document.updateMany({
      where: {
        estateId,
        visibilityReviewPending: true,
        ...(all ? {} : { id: { in: documentIds } }),
      },
      data: { visibilityReviewPending: false },
    });
    return { reviewed: count };
  }

  // ── Generated documents (actas) ──────────────────────────────────────
  /** A signed acta (generated in Domora or uploaded) enters «Actas y juntas» as «Solo gestora». Idempotent. */
  async registerSignedActa(meetingId: string): Promise<string | null> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        id: true,
        estateId: true,
        title: true,
        scheduledAt1: true,
        actaS3Key: true,
        actaSignedAt: true,
        actaOrigin: true,
        actaUploadMimeType: true,
        actaUploadSizeBytes: true,
      },
    });
    if (!meeting?.estateId || !meeting.actaS3Key) return null;
    const estateId = meeting.estateId;
    return this.prisma.$transaction(async (tx) => {
      await this.ensureTemplate(estateId, tx);
      const existing = await tx.document.findFirst({
        where: { estateId, sourceRef: meetingRef(meeting.id) },
        select: { id: true },
      });
      if (existing) return existing.id;
      const folder = await tx.documentFolder.findFirstOrThrow({
        where: { estateId, systemKey: 'actas' },
        select: { id: true },
      });
      const uploaded = meeting.actaOrigin === 'uploaded';
      const sizeBytes = uploaded ? meeting.actaUploadSizeBytes : null;
      const doc = await tx.document.create({
        data: {
          estateId,
          folderId: folder.id,
          source: 'generated',
          sourceRef: meetingRef(meeting.id),
          title: `Acta — ${meeting.title}`,
          type: 'Acta',
          date: meeting.scheduledAt1 ?? meeting.actaSignedAt ?? new Date(),
          size: sizeBytes ? humanSize(sizeBytes) : '—',
          sizeBytes,
          mimeType: uploaded
            ? meeting.actaUploadMimeType
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          s3Key: meeting.actaS3Key,
        },
      });
      await this.recompute(estateId, tx);
      return doc.id;
    });
  }

  /** D4: sending the acta to the owners is what opens it to them. Returns the documents just opened. */
  async publishActa(meetingId: string): Promise<string[]> {
    const documentId = await this.registerSignedActa(meetingId);
    if (!documentId) return [];
    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      select: { estateId: true },
    });
    const opened = await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: documentId },
        data: { visibility: 'OWNERS', visibilityReviewPending: false },
      });
      return this.recompute(doc.estateId!, tx);
    });
    // The acta e-mail (sendActaNotice) already told the owners: no second notice here.
    return opened;
  }

  /** Which storage keys a generated document may point at (downloads validate them). */
  static generatedKeyPrefix(sourceRef: string | null): string | null {
    const match = /^meeting:([0-9a-f-]{36})$/i.exec(sourceRef ?? '');
    return match ? `meetings/${match[1]}/` : null;
  }
}

export type { DocumentVisibility };
