import {
  issuesOfEstate,
} from '../issues/issue-estate';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import {
  EstateOverviewDto,
  EstateOverviewItemDto,
  EstateOverviewQueryDto,
  EstateOverviewFilterDto,
  EstateManagementSearchResultDto,
} from './dto/estate-overview.dto';
import {
  normalizeCadastralReference,
  validateFacadeUrl,
} from '../catastro/catastro-facade.service';

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

/** Fiscal identity is internal only. Unknown country/ID never collapses namesakes. */
export function ownerKey(
  owner: { taxIdCountry: string | null; taxId: string | null },
  fallback: string,
): string {
  const taxId = owner.taxId?.replace(/[\s.\-]/g, '').toUpperCase();
  return taxId && owner.taxIdCountry
    ? `tax:${owner.taxIdCountry}:${taxId}`
    : fallback;
}

@Injectable()
export class EstateOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerQueryService,
  ) {}

  /** `administratorId` narrows role A to one despacho (S1); ignored for B. */
  private scope(
    user: AuthenticatedUser,
    administratorId?: string,
  ): Prisma.EstateWhereInput {
    if (user.role !== 'A' && user.role !== 'B')
      throw new ForbiddenException(
        'Solo gestión puede consultar el resumen de fincas.',
      );
    if (user.role === 'B' && !user.administratorId)
      throw new ForbiddenException('No hay gestora asociada.');
    return {
      deletedAt: null,
      ...(user.role === 'A'
        ? administratorId
          ? { administratorId }
          : {}
        : {
            id: { in: user.estateIds },
            administratorId: user.administratorId!,
          }),
    };
  }

  private estates(user: AuthenticatedUser, administratorId?: string) {
    return this.prisma.estate.findMany({
      where: this.scope(user, administratorId),
      select: {
        id: true,
        name: true,
        address: true,
        streetNumber: true,
        location: true,
        type: true,
        cadastralReference: true,
        catastroFacadeUrl: true,
        photoUpdatedAt: true,
      },
    });
  }

  async overview(
    query: EstateOverviewQueryDto,
    user: AuthenticatedUser,
  ): Promise<EstateOverviewDto> {
    const result = await this.selectOverview(query, user);
    const totalPages = Math.ceil(result.total / query.pageSize);
    const page = Math.min(query.page, Math.max(1, totalPages));
    return {
      ...result,
      items: result.items.slice(
        (page - 1) * query.pageSize,
        page * query.pageSize,
      ),
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  /** Same scoped selection for the paginated UI and the complete Excel export. */
  async selectOverview(
    query: EstateOverviewFilterDto & { administratorId?: string },
    user: AuthenticatedUser,
  ): Promise<
    Pick<EstateOverviewDto, 'items' | 'total' | 'pendingLabel' | 'summary'>
  > {
    const estates = await this.estates(user, query.administratorId);
    const ids = estates.map((estate) => estate.id);
    const inProperties: Prisma.PropertyWhereInput = {
      estateId: { in: ids },
      deletedAt: null,
    };
    // Query count is fixed; sorting/filtering all scoped aggregates occurs on the server BEFORE slicing.
    const [
      memberships,
      external,
      issues,
      requests,
      properties,
      balances,
      pending,
    ] = ids.length
      ? await Promise.all([
          this.prisma.propertyMembership.findMany({
            where: {
              roleType: 'Propietario',
              status: 'linked',
              revokedAt: null,
              user: { deletedAt: null },
              property: inProperties,
            },
            select: {
              userId: true,
              user: { select: { taxIdCountry: true, taxId: true } },
              property: { select: { estateId: true } },
            },
          }),
          this.prisma.externalOwner.findMany({
            where: { promotedToUserId: null, property: inProperties },
            select: {
              id: true,
              taxIdCountry: true,
              taxId: true,
              property: { select: { estateId: true } },
            },
          }),
          this.prisma.issue.groupBy({
            by: ['estateId'],
            where: {
              deletedAt: null,
              status: { in: ACTIVE_ISSUE_STATUSES },
              ...issuesOfEstate(ids),
            },
            _count: { _all: true },
          }),
          this.prisma.adhesionRequest.groupBy({
            by: ['estateId'],
            where: { estateId: { in: ids }, status: 'pending' },
            _count: { _all: true },
          }),
          this.prisma.property.groupBy({
            by: ['estateId'],
            where: inProperties,
            _count: { _all: true },
          }),
          this.ledger.treasuryBalancesForEstates(ids),
          this.prisma.accountingReceipt.groupBy({
            by: ['estateId'],
            where: {
              estateId: { in: ids },
              kind: 'cuota_ordinaria',
              status: { in: ['Pendiente', 'Parcial', 'Devuelto'] },
            },
            _sum: { outstanding: true },
          }),
        ])
      : ([[], [], [], [], [], new Map<string, Prisma.Decimal>(), []] as const);
    const owners = new Map<string, Set<string>>();
    const addOwner = (id: string | null, key: string) => {
      if (id) {
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id)!.add(key);
      }
    };
    for (const member of memberships)
      addOwner(
        member.property.estateId,
        ownerKey(member.user, `user:${member.userId}`),
      );
    for (const owner of external)
      addOwner(
        owner.property.estateId,
        ownerKey(owner, `external:${owner.id}`),
      );
    const issueCounts = new Map<string, number>();
    for (const issue of issues) {
      if (issue.estateId) issueCounts.set(issue.estateId, issue._count._all);
    }
    const requestCounts = new Map(
      requests.map((row) => [row.estateId, row._count._all]),
    );
    const pendingAmounts = new Map(
      pending.map((row) => [
        row.estateId,
        row._sum.outstanding ?? new Prisma.Decimal(0),
      ]),
    );
    const zero = new Prisma.Decimal(0);
    const q = normalize(query.search);
    let items: EstateOverviewItemDto[] = estates
      .filter(
        (estate) =>
          (!q ||
            normalize(
              `${estate.name} ${estate.address} ${estate.streetNumber ?? ''} ${estate.location}`,
            ).includes(q)) &&
          (!query.types.length || query.types.includes(estate.type)),
      )
      .map((estate) => {
        const facade = estate.catastroFacadeUrl
          ? validateFacadeUrl(estate.catastroFacadeUrl)
          : null;
        const parcel = normalizeCadastralReference(
          estate.cadastralReference,
        )?.parcelReference;
        return {
          ...estate,
          catastroFacadeUrl:
            facade &&
            parcel &&
            new URL(facade).searchParams
              .get('ReferenciaCatastral')
              ?.slice(0, 14) === parcel
              ? facade
              : null,
          ownersCount: owners.get(estate.id)?.size ?? 0,
          balance: (balances.get(estate.id) ?? zero).toFixed(2),
          activeIssues: issueCounts.get(estate.id) ?? 0,
          pendingAmount: (pendingAmounts.get(estate.id) ?? zero).toFixed(2),
          pendingRequests: requestCounts.get(estate.id) ?? 0,
        };
      });
    items = items.filter((item) =>
      query.filter === 'issues'
        ? item.activeIssues > 0
        : query.filter === 'pending'
          ? new Prisma.Decimal(item.pendingAmount).greaterThan(0)
          : query.filter === 'requests'
            ? item.pendingRequests > 0
            : true,
    );
    const direction = query.direction === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      const key = query.sort;
      const comparison =
        key === 'name'
          ? a.name.localeCompare(b.name, 'es')
          : key === 'balance' || key === 'pendingAmount'
            ? new Prisma.Decimal(a[key]).comparedTo(b[key])
            : a[key] - b[key];
      return comparison * direction || a.id.localeCompare(b.id);
    });
    const total = items.length;
    return {
      items,
      total,
      pendingLabel: 'Cuotas pendientes',
      summary: {
        communities: estates.length,
        properties: properties.reduce((sum, row) => sum + row._count._all, 0),
        pendingRequests: requests.reduce(
          (sum, row) => sum + row._count._all,
          0,
        ),
      },
    };
  }

  async search(
    value: string,
    user: AuthenticatedUser,
  ): Promise<EstateManagementSearchResultDto[]> {
    const scope = this.scope(user);
    const q = value.trim();
    if (q.length < 2) return [];
    const contains = { contains: q, mode: 'insensitive' as const };
    const propertyScope: Prisma.PropertyWhereInput = {
      deletedAt: null,
      estate: scope,
    };
    const estateSelect = {
      id: true,
      name: true,
      address: true,
      streetNumber: true,
      location: true,
    } as const;
    const propertySelect = { estate: { select: estateSelect } } as const;
    // Match and bound every domain in the database. Descriptions are searched, never returned.
    const [estates, members, external, issues] = await Promise.all([
      this.prisma.estate.findMany({
        where: {
          AND: [
            scope,
            {
              OR: [
                { name: contains },
                { address: contains },
                { streetNumber: contains },
                { location: contains },
              ],
            },
          ],
        },
        select: estateSelect,
        orderBy: { name: 'asc' },
        take: 5,
      }),
      this.prisma.propertyMembership.findMany({
        where: {
          roleType: 'Propietario',
          status: 'linked',
          revokedAt: null,
          user: { deletedAt: null, fullName: contains },
          property: propertyScope,
        },
        select: {
          userId: true,
          user: { select: { fullName: true } },
          property: { select: propertySelect },
        },
        orderBy: { user: { fullName: 'asc' } },
        take: 10,
      }),
      this.prisma.externalOwner.findMany({
        where: {
          promotedToUserId: null,
          fullName: contains,
          property: propertyScope,
        },
        select: {
          id: true,
          fullName: true,
          property: { select: propertySelect },
        },
        orderBy: { fullName: 'asc' },
        take: 5,
      }),
      this.prisma.issue.findMany({
        where: {
          deletedAt: null,
          estate: scope,
          OR: [
            { title: contains },
            { description: contains },
            { ref: contains },
          ],
        },
        select: { id: true, title: true, estate: { select: estateSelect } },
        orderBy: { title: 'asc' },
        take: 5,
      }),
    ]);
    const results: EstateManagementSearchResultDto[] = [];
    const add = (
      kind: EstateManagementSearchResultDto['kind'],
      id: string,
      label: string,
      estate: (typeof estates)[number] | null,
      issueId?: string,
    ) => {
      if (!estate) return;
      results.push({
        kind,
        id,
        label,
        estateId: estate.id,
        estateName: estate.name,
        address: [estate.address, estate.streetNumber, estate.location]
          .filter(Boolean)
          .join(' '),
        ...(issueId ? { issueId } : {}),
      });
    };
    for (const estate of estates)
      add('community', estate.id, estate.name, estate);
    const seen = new Set<string>();
    for (const member of members) {
      const key = `${member.userId}:${member.property.estate?.id}`;
      if (!seen.has(key)) {
        add('owner', key, member.user.fullName, member.property.estate);
        seen.add(key);
      }
    }
    for (const owner of external)
      add('owner', owner.id, owner.fullName, owner.property.estate);
    for (const issue of issues)
      add('issue', issue.id, issue.title, issue.estate, issue.id);
    // Reserve five slots per domain so owners cannot hide matching incidents.
    return (['community', 'owner', 'issue'] as const).flatMap((kind) =>
      results.filter((result) => result.kind === kind).slice(0, 5),
    );
  }
}
