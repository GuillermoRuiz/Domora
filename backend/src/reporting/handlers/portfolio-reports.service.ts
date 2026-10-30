import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateOverviewService } from '../../estates/estate-overview.service';
import { EstateOverviewFilterDto } from '../../estates/dto/estate-overview.dto';
import { MeetingsService } from '../../meetings/meetings.service';
import type { ReportData, ReportInput, ReportScope } from '../reporting.types';
import {
  checkLimit,
  date,
  day,
  int,
  money,
  ownerIdentity,
  REPORT_LIMIT,
  table,
  text,
} from './report-rules';

@Injectable()
export class PortfolioReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly overview: EstateOverviewService,
    private readonly meetings: MeetingsService,
  ) {}

  async run(
    key: string,
    input: ReportInput,
    scope: ReportScope,
  ): Promise<ReportData> {
    const names = new Map(scope.estates.map((e) => [e.id, e.name]));
    if (key === 'portfolio-summary') {
      const result = await this.overview.selectOverview(
        new EstateOverviewFilterDto(),
        {
          ...scope.user,
          estateIds: scope.estateIds,
          administratorId: scope.administratorId,
        },
      );
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              int('owners', 'Titulares'),
              money('treasury', 'Tesorería actual'),
              money('pending', 'Cuotas ordinarias pendientes actuales'),
              int('issues', 'Incidencias abiertas'),
            ],
            result.items.map((e) => ({
              estate: e.name,
              owners: e.ownersCount,
              treasury: Number(e.balance),
              pending: Number(e.pendingAmount),
              issues: e.activeIssues,
            })),
          ),
        ],
        warnings: [
          'Resumen actual. Pendiente incluye únicamente cuotas ordinarias, también no vencidas; los titulares se cuentan con el criterio del resumen de cartera existente.',
        ],
        summary: [
          {
            label: 'Comunidades',
            value: result.summary.communities,
            format: 'number',
          },
          {
            label: 'Propiedades',
            value: result.summary.properties,
            format: 'number',
          },
        ],
      };
    }
    if (key === 'communities') {
      const rows = checkLimit(
        await this.prisma.estate.findMany({
          where: {
            id: { in: scope.estateIds },
            administratorId: scope.administratorId,
            deletedAt: null,
          },
          select: {
            name: true,
            type: true,
            address: true,
            location: true,
            createdAt: true,
            _count: { select: { properties: { where: { deletedAt: null } } } },
          },
          orderBy: { name: 'asc' },
          take: REPORT_LIMIT + 1,
        }),
      );
      return {
        sections: [
          table(
            [
              text('name', 'Comunidad'),
              text('type', 'Tipo'),
              text('address', 'Dirección'),
              text('location', 'Localidad'),
              int('properties', 'Propiedades'),
              text('created', 'Alta'),
            ],
            rows.map((e) => ({
              name: e.name,
              type: e.type,
              address: e.address,
              location: e.location,
              properties: e._count.properties,
              created: day(e.createdAt),
            })),
          ),
        ],
      };
    }
    if (key === 'presidents') {
      const cut = date(input.asOf ?? day(new Date()));
      const rows = checkLimit(
        await this.prisma.estateOfficeTerm.findMany({
          where: {
            estateId: { in: scope.estateIds },
            role: 'PRESIDENT',
            startsAt: { lte: cut },
            OR: [{ endsAt: null }, { endsAt: { gt: cut } }],
          },
          select: {
            estateId: true,
            holderNameSnapshot: true,
            startsAt: true,
            endsAt: true,
            propertyId: true,
          },
          orderBy: { startsAt: 'desc' },
          take: REPORT_LIMIT + 1,
        }),
      );
      const propertyRefs = new Map(
        (
          await this.prisma.property.findMany({
            where: {
              estateId: { in: scope.estateIds },
              id: {
                in: rows.flatMap((r) => (r.propertyId ? [r.propertyId] : [])),
              },
            },
            select: { id: true, ref: true },
          })
        ).map((p) => [p.id, p.ref]),
      );
      const missing = scope.estates.filter(
        (e) => !rows.some((r) => r.estateId === e.id),
      );
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('holder', 'Presidente'),
              text('property', 'Propiedad'),
              text('start', 'Inicio'),
              text('end', 'Fin exclusivo'),
            ],
            rows.map((r) => ({
              estate: names.get(r.estateId),
              holder: r.holderNameSnapshot,
              property: r.propertyId ? propertyRefs.get(r.propertyId) : '',
              start: day(r.startsAt),
              end: day(r.endsAt),
            })),
          ),
        ],
        warnings: missing.length
          ? [
              `${missing.length} comunidades sin presidente registrado vigente a la fecha de corte.`,
            ]
          : [],
      };
    }
    if (key === 'meeting-participation') {
      const sections = [];
      for (const estate of scope.estates) {
        const rows = await this.meetings.getParticipationHistory(
          estate.id,
          { ...scope.user, estateIds: scope.estateIds },
          {
            from: input.from ? date(input.from) : undefined,
            to: input.to ? date(input.to) : undefined,
            limit: 500,
          },
        );
        sections.push(
          table(
            [
              text('title', 'Junta'),
              text('date', 'Celebración'),
              text('quorum', 'Quórum'),
              text('delegation', 'Uso de delegación %'),
            ],
            rows.map((r) => ({
              title: r.title,
              date: day(r.celebratedAt),
              quorum: r.quorumMet ? 'Sí' : 'No',
              delegation: r.delegationUsageRate,
            })),
            estate.name,
          ),
        );
      }
      return {
        sections,
        warnings: [
          'Participación según el motor de juntas existente; uso de delegación respecto al número actual de propiedades. Límite explícito: 500 juntas por comunidad.',
        ],
      };
    }
    if (key === 'properties') {
      const rows = checkLimit(
        await this.prisma.property.findMany({
          where: { estateId: { in: scope.estateIds }, deletedAt: null },
          select: {
            id: true,
            estateId: true,
            ref: true,
            type: true,
            status: true,
            participationQuota: true,
            viaName: true,
            streetNumber: true,
            floor: true,
            door: true,
            municipality: true,
          },
          orderBy: { ref: 'asc' },
          take: REPORT_LIMIT + 1,
        }),
      );
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('property', 'Propiedad'),
              text('address', 'Dirección'),
              text('municipality', 'Municipio'),
              text('type', 'Tipo'),
              text('status', 'Estado'),
              text('quota', 'Coeficiente %'),
            ],
            rows.map((p) => ({
              estate: names.get(p.estateId!),
              property: p.ref ?? p.id,
              address: [p.viaName, p.streetNumber, p.floor, p.door]
                .filter(Boolean)
                .join(' '),
              municipality: p.municipality,
              type: p.type,
              status: p.status,
              quota: p.participationQuota?.toString(),
            })),
          ),
        ],
      };
    }
    const properties = checkLimit(
      await this.prisma.property.findMany({
        where: {
          estateId: { in: scope.estateIds },
          deletedAt: null,
          ...(input.filters?.propertyId
            ? { id: input.filters.propertyId }
            : {}),
        },
        select: {
          id: true,
          estateId: true,
          ref: true,
          type: true,
          status: true,
          participationQuota: true,
          memberships: {
            where: {
              roleType: 'Propietario',
              status: 'linked',
              revokedAt: null,
              user: { deletedAt: null },
            },
            select: {
              userId: true,
              user: {
                select: { fullName: true },
              },
            },
          },
          externalOwners: {
            where: { promotedToUserId: null, roleType: 'Propietario' },
            select: {
              id: true,
              fullName: true,
              taxIdCountry: key === 'owners',
              taxId: key === 'owners',
            },
          },
        },
        orderBy: { ref: 'asc' },
        take: REPORT_LIMIT + 1,
      }),
    );
    if (key === 'owners-coefficients')
      return {
        sections: [
          table(
            [
              text('estate', 'Comunidad'),
              text('property', 'Propiedad'),
              text('owners', 'Titulares actuales'),
              text('quota', 'Coeficiente de la propiedad %'),
              int('count', 'Cotitulares'),
            ],
            properties.map((p) => {
              const owners = [
                ...p.memberships.map((m) => m.user.fullName),
                ...p.externalOwners.map((o) => o.fullName),
              ];
              return {
                estate: names.get(p.estateId!),
                property: p.ref ?? p.id,
                owners: owners.join('; ') || 'Sin titular registrado',
                quota: p.participationQuota?.toString(),
                count: owners.length,
              };
            }),
          ),
        ],
        warnings: [
          'El coeficiente pertenece a la propiedad y se muestra una sola vez. No se reparte ni se duplica entre cotitulares; no consta porcentaje individual de titularidad.',
        ],
      };
    if (key === 'owners') {
      const owners = new Map<
        string,
        { name: string; properties: Set<string>; estates: Set<string> }
      >();
      for (const p of properties) {
        const add = (identity: string, name: string) => {
          let owner = owners.get(identity);
          if (!owner) {
            owner = { name, properties: new Set(), estates: new Set() };
            owners.set(identity, owner);
          }
          owner.properties.add(`${names.get(p.estateId!)} · ${p.ref ?? p.id}`);
          owner.estates.add(p.estateId!);
        };
        for (const member of p.memberships)
          add(
            ownerIdentity({ id: member.userId, userId: member.userId }),
            member.user.fullName,
          );
        for (const owner of p.externalOwners)
          add(
            ownerIdentity({
              id: owner.id,
              taxCountry: owner.taxIdCountry,
              taxId: owner.taxId,
            }),
            owner.fullName,
          );
      }
      return {
        sections: [
          table(
            [
              text('name', 'Titular'),
              text('properties', 'Propiedades'),
              int('estates', 'Comunidades'),
            ],
            [...owners.values()].map((o) => ({
              name: o.name,
              properties: [...o.properties].join('; '),
              estates: o.estates.size,
            })),
          ),
        ],
        warnings: [
          'Usuarios consolidados por User.id. Titulares externos solo por NIF/NIE/CIF español con checksum válido; los demás permanecen separados. No se deduplica por nombre ni email.',
        ],
      };
    }
    throw new NotFoundException('Informe de cartera desconocido.');
  }
}
