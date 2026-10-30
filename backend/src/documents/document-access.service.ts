import { Injectable } from '@nestjs/common';
import type { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { managerOnlyFolderIds, type FolderNode } from './document-visibility';

/** Owners for document visibility (D1): never tenants nor other occupants. */
export const DOCUMENT_OWNER_ROLES = ['Propietario', 'Representante'] as const;

/** Matches nothing: used for users that no longer exist or have no role. */
const NOTHING: Prisma.DocumentWhereInput = { id: { in: [] } };

/** The folder tree of an estate, read with the memberships and offices (no extra query). */
const ESTATE_FOLDERS = { select: { documentFolders: { select: { id: true, parentId: true, visibility: true, systemKey: true } } } } as const;

/**
 * The ONLY place that decides which documents a user may see. Every read of
 * `Document` (download, assistant, lists, alerts, activity, KPIs) must AND
 * its query with `visibleWhere(user)`.
 *
 * - A: every live document.
 * - B: live documents of the estates of their administrator (read from the DB, not the token).
 * - C: `effectiveVisibility` OWNERS of estates where they own a property, PROPERTY of their own
 *   properties, and BOARD of estates where they hold an office in force. Never MANAGER, and never
 *   anything inside «Interno de la gestora» (G2) even if a stored effective visibility said otherwise.
 */
export async function documentVisibleWhere(prisma: PrismaService, user: AuthenticatedUser): Promise<Prisma.DocumentWhereInput> {
  const current = await prisma.user.findFirst({
    where: { id: user.id, deletedAt: null },
    select: { id: true, role: true, administratorId: true },
  });
  if (!current) return NOTHING;
  const live: Prisma.DocumentWhereInput = { deletedAt: null };
  if (current.role === 'A') return live;
  if (current.role === 'B') {
    return current.administratorId ? { ...live, estate: { administratorId: current.administratorId, deletedAt: null } } : NOTHING;
  }
  if (current.role !== 'C') return NOTHING;

  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [memberships, offices] = await Promise.all([
    prisma.propertyMembership.findMany({
      where: {
        userId: current.id, status: 'linked', revokedAt: null, roleType: { in: [...DOCUMENT_OWNER_ROLES] },
        property: { deletedAt: null, estate: { deletedAt: null } },
      },
      select: { propertyId: true, property: { select: { estateId: true, estate: ESTATE_FOLDERS } } },
    }),
    prisma.estateOfficeTerm.findMany({
      where: { userId: current.id, estate: { deletedAt: null }, startsAt: { lte: today }, OR: [{ endsAt: null }, { endsAt: { gt: today } }] },
      select: { estateId: true, estate: ESTATE_FOLDERS },
    }),
  ]);
  const propertyIds = [...new Set(memberships.map((m) => m.propertyId))];
  const ownerEstateIds = [...new Set(memberships.map((m) => m.property.estateId).filter((id): id is string => !!id))];
  // An office term only counts while its holder is still a linked owner of that estate:
  // revoking a membership does not end office terms, and tenants or pending owners never qualify.
  const boardEstateIds = [...new Set(offices.map((o) => o.estateId))].filter((id) => ownerEstateIds.includes(id));
  const visible: Prisma.DocumentWhereInput[] = [];
  if (ownerEstateIds.length) visible.push({ effectiveVisibility: 'OWNERS', estateId: { in: ownerEstateIds } });
  if (propertyIds.length) visible.push({ effectiveVisibility: 'PROPERTY', targetPropertyId: { in: propertyIds } });
  if (boardEstateIds.length) visible.push({ effectiveVisibility: 'BOARD', estateId: { in: boardEstateIds } });
  if (!visible.length) return NOTHING;
  // Defence in depth for G2: the library never opens these folders, and owners never see them anyway.
  const folders = new Map<string, FolderNode>();
  for (const f of [...memberships.map((m) => m.property.estate), ...offices.map((o) => o.estate)].flatMap((e) => e?.documentFolders ?? [])) folders.set(f.id, f);
  const managerOnly = [...managerOnlyFolderIds([...folders.values()])];
  if (!managerOnly.length) return { ...live, OR: visible };
  return { ...live, AND: [{ OR: visible }, { OR: [{ folderId: null }, { folderId: { notIn: managerOnly } }] }] };
}

/** Injectable wrapper of `documentVisibleWhere` for services built by Nest. */
@Injectable()
export class DocumentAccessService {
  constructor(private readonly prisma: PrismaService) {}
  visibleWhere(user: AuthenticatedUser): Promise<Prisma.DocumentWhereInput> {
    return documentVisibleWhere(this.prisma, user);
  }
}
