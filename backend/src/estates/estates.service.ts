import { issuesOfEstate } from '../issues/issue-estate';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { CryptoService } from '../sepa/crypto.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateEstateDto, UpdateEstateDto } from './dto/create-estate.dto';
import type { UpdateSepaBillingDto } from './dto/update-sepa-billing.dto';
import { bootstrapEstateLedger } from '../ledger/chart/ledger-bootstrap';
import { ACTIVE_ISSUE_STATUSES } from '../issues/issue-status.constants';
import { CatastroFacadeService } from '../catastro/catastro-facade.service';
import { EstateGeoService } from '../catastro/estate-geo.service';
import { StorageService } from '../files/storage.service';
import { ESTATE_PRIVATE_OMIT, withoutManagerOnlyFields } from '../common/secret-omit';

/** Tamaño máximo de la foto de una finca. */
export const ESTATE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Tipo real de la imagen por sus primeros bytes: el `Content-Type` que manda
 * el navegador se puede falsificar, así que no se confía en él. Solo JPG,
 * PNG y WebP (nada de SVG: puede llevar scripts).
 */
export function detectImageType(buffer: Buffer): { contentType: string; extension: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { contentType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { contentType: 'image/webp', extension: 'webp' };
  }
  return null;
}

/** Fields that move the estate on the map: changing any of them locates it again. */
const LOCATION_FIELDS = ['address', 'streetNumber', 'postalCode', 'location', 'province', 'cadastralReference'] as const;

@Injectable()
export class EstatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly cryptoService: CryptoService,
    private readonly facade: CatastroFacadeService,
    private readonly storage: StorageService,
    private readonly geo: EstateGeoService,
  ) {}

  private assertGestoraOrAdmin(
    estate: { administratorId: string },
    user: AuthenticatedUser,
  ): void {
    if (user.role !== 'A' && estate.administratorId !== user.administratorId) {
      throw new ForbiddenException('No tienes permiso para esta finca.');
    }
  }

  /**
   * Role A ve todas las fincas; el resto de roles queda acotado a
   * `user.estateIds` (fincas gestionadas, para B; fincas con membresía
   * `linked`, para C) — mismo criterio que EstateScopeGuard.
   *
   * `properties`/`residents`/`requests`/`occupancy` no son columnas de
   * `Estate` (no se persisten, como `AccountingEstate` o `usersActive` —
   * ver comentarios en admins.service.ts) — se calculan aquí a partir de
   * Property/PropertyMembership/AdhesionRequest para el panel "Fincas".
   */
  async list(user: AuthenticatedUser, administratorId?: string) {
    const estates = await this.prisma.estate.findMany({
      where: {
        deletedAt: null,
        // Estate's own PK is what's scoped here (not an `estateId` FK, as in
        // most other models) — EstateAccessService.scopedWhere doesn't apply.
        // Role A may narrow to one despacho (S1); B/C ignore the filter.
        ...(user.role === 'A'
          ? administratorId
            ? { administratorId }
            : {}
          : { id: { in: user.estateIds } }),
      },
      omit: ESTATE_PRIVATE_OMIT,
      orderBy: { name: 'asc' },
    });
    if (estates.length === 0) return [];

    const estateIds = estates.map((e) => e.id);
    const [
      propertyCounts,
      occupiedCounts,
      pendingCounts,
      memberships,
      activeIssues,
    ] = await Promise.all([
      this.prisma.property.groupBy({
        by: ['estateId'],
        where: { estateId: { in: estateIds }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.property.groupBy({
        by: ['estateId'],
        where: {
          estateId: { in: estateIds },
          deletedAt: null,
          status: 'Ocupado',
        },
        _count: { _all: true },
      }),
      this.prisma.adhesionRequest.groupBy({
        by: ['estateId'],
        where: { estateId: { in: estateIds }, status: 'pending' },
        _count: { _all: true },
      }),
      this.prisma.propertyMembership.findMany({
        where: {
          status: 'linked',
          revokedAt: null,
          property: { estateId: { in: estateIds }, deletedAt: null },
        },
        select: { userId: true, property: { select: { estateId: true } } },
      }),
      // Incidencias activas por finca (`Issue.estateId`: las de vivienda y las comunes).
      this.prisma.issue.groupBy({
        by: ['estateId'],
        where: {
          deletedAt: null,
          status: { in: ACTIVE_ISSUE_STATUSES },
          ...issuesOfEstate(estateIds),
        },
        _count: { _all: true },
      }),
    ]);

    const propertiesByEstate = new Map(
      propertyCounts.map((r) => [r.estateId, r._count._all]),
    );
    const occupiedByEstate = new Map(
      occupiedCounts.map((r) => [r.estateId, r._count._all]),
    );
    const pendingByEstate = new Map(
      pendingCounts.map((r) => [r.estateId, r._count._all]),
    );
    const residentsByEstate = new Map<string, Set<string>>();
    for (const m of memberships) {
      const estateId = m.property.estateId;
      if (!estateId) continue;
      if (!residentsByEstate.has(estateId)) {
        residentsByEstate.set(estateId, new Set());
      }
      residentsByEstate.get(estateId)!.add(m.userId);
    }
    const activeIssuesByEstate = new Map<string, number>();
    for (const i of activeIssues) {
      if (!i.estateId) continue;
      activeIssuesByEstate.set(i.estateId, i._count._all);
    }

    return estates.map((estate) => {
      const properties = propertiesByEstate.get(estate.id) ?? 0;
      const occupied = occupiedByEstate.get(estate.id) ?? 0;
      return {
        ...withoutManagerOnlyFields(estate, user.role),
        properties,
        residents: residentsByEstate.get(estate.id)?.size ?? 0,
        requests: pendingByEstate.get(estate.id) ?? 0,
        activeIssues: activeIssuesByEstate.get(estate.id) ?? 0,
        occupancy:
          properties > 0 ? Math.round((occupied / properties) * 100) : 0,
      };
    });
  }

  async findById(id: string, user: AuthenticatedUser) {
    const estate = await this.prisma.estate.findFirst({
      where: { id, deletedAt: null },
      omit: ESTATE_PRIVATE_OMIT,
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${id} no encontrada.`);
    }
    this.estateAccess.assertAccess(estate.id, user);
    return withoutManagerOnlyFields(estate, user.role);
  }

  /**
   * Datos del acreedor SEPA — separados del resto de la ficha de finca
   * porque `creditorIban` va cifrado (nunca en el listado general de
   * fincas). El IBAN se devuelve ENMASCARADO, nunca en claro — igual que
   * `RemesasService.listCandidates`/`listLines` — así que "editar" siempre
   * significa reemplazarlo por uno nuevo, nunca ver el guardado completo.
   * Ver doc/frontend-zoneless-audit-guide.md §5.2.
   */
  async getSepaBilling(id: string, user: AuthenticatedUser) {
    const estate = await this.prisma.estate.findFirst({
      where: { id, deletedAt: null },
      select: {
        administratorId: true,
        creditorId: true,
        creditorIban: true,
        creditorBic: true,
        creditorPostalAddress: true,
      },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${id} no encontrada.`);
    }
    this.assertGestoraOrAdmin(estate, user);
    return {
      creditorId: estate.creditorId,
      creditorIbanMasked: estate.creditorIban
        ? this.cryptoService.maskIban(
            this.cryptoService.decrypt(estate.creditorIban),
          )
        : null,
      creditorBic: estate.creditorBic,
      creditorPostalAddress: estate.creditorPostalAddress,
    };
  }

  async updateSepaBilling(
    id: string,
    dto: UpdateSepaBillingDto,
    user: AuthenticatedUser,
  ) {
    const estate = await this.prisma.estate.findFirst({
      where: { id, deletedAt: null },
      select: { administratorId: true },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${id} no encontrada.`);
    }
    this.assertGestoraOrAdmin(estate, user);

    await this.prisma.estate.update({
      where: { id },
      data: {
        ...(dto.creditorId !== undefined ? { creditorId: dto.creditorId } : {}),
        ...(dto.creditorIban !== undefined
          ? { creditorIban: this.cryptoService.encrypt(dto.creditorIban) }
          : {}),
        ...(dto.creditorBic !== undefined
          ? { creditorBic: dto.creditorBic }
          : {}),
        ...(dto.creditorPostalAddress !== undefined
          ? { creditorPostalAddress: dto.creditorPostalAddress }
          : {}),
      },
    });
    return this.getSepaBilling(id, user);
  }

  /**
   * Solo el rol B puede crear fincas, y siempre bajo su propia gestora
   * (`administratorId` del JWT, nunca uno enviado por el cliente). Deja
   * lista su contabilidad en la misma transacción: fecha de corte (primer
   * día del mes en curso, editable mientras no haya apertura), plan de
   * cuentas de comunidades como filas PROPIAS de la finca y una cuenta
   * bancaria por defecto — ver ledger/chart/ledger-bootstrap.ts.
   */
  async create(dto: CreateEstateDto, user: AuthenticatedUser) {
    if (user.role !== 'B' || !user.administratorId) {
      throw new ForbiddenException('Solo una gestora puede crear fincas.');
    }
    const administratorId = user.administratorId;
    const estate = await this.prisma.$transaction(async (tx) => {
      const estate = await tx.estate.create({
        data: { ...dto, administratorId },
        omit: ESTATE_PRIVATE_OMIT,
      });
      await bootstrapEstateLedger(tx, estate.id);
      return estate;
    });
    if (estate.cadastralReference) await this.facade.refreshEstate(estate.id, estate.cadastralReference);
    // In the background: the map location never delays saving the estate.
    void this.geo.refreshEstate(estate.id);
    return estate;
  }

  /**
   * Solo el rol A o la propia gestora de la finca pueden editarla — mismo
   * criterio que `create()`, pero comprobado contra la finca ya existente
   * en vez de confiar en el `administratorId` del body.
   */
  async update(id: string, dto: UpdateEstateDto, user: AuthenticatedUser) {
    const estate = await this.prisma.estate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${id} no encontrada.`);
    }
    this.assertGestoraOrAdmin(estate, user);
    const data = {
      ...dto,
      ...(typeof dto.cif === 'string' ? { cif: dto.cif.toUpperCase() } : {}),
    };
    let facadeStale = false;
    let updated;
    if (dto.cadastralReference === undefined) {
      updated = await this.prisma.estate.update({ where: { id }, data, omit: ESTATE_PRIVATE_OMIT });
    } else {
      // Compare with the row locked, not with the snapshot above: two crossed saves must never leave
      // one reference with the facade of another. An unchanged, already resolved reference keeps its photo.
      const next = dto.cadastralReference ?? null;
      ({ updated, facadeStale } = await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ cadastral_reference: string | null; catastro_facade_resolved_at: Date | null }[]>`
          SELECT cadastral_reference, catastro_facade_resolved_at FROM estates WHERE id = ${id}::uuid FOR UPDATE`;
        const stale = (row?.cadastral_reference ?? null) !== next || (next !== null && !row?.catastro_facade_resolved_at);
        const saved = await tx.estate.update({
          where: { id },
          data: { ...data, ...(stale ? { catastroFacadeUrl: null, catastroFacadeResolvedAt: null } : {}) },
          omit: ESTATE_PRIVATE_OMIT,
        });
        return { updated: saved, facadeStale: stale };
      }));
    }
    // The edit form always sends the whole address: only a real change locates the estate again.
    const moved = LOCATION_FIELDS.some((field) => dto[field] !== undefined && (dto[field] || null) !== (estate[field] || null));
    if (moved) void this.geo.refreshEstate(id);
    if (facadeStale) {
      // `updated` was read with the facade cleared: return the one just resolved, or the client shows no photo until reload.
      const facadeUrl = await this.facade.refreshEstate(id, dto.cadastralReference ?? null);
      return { ...updated, catastroFacadeUrl: facadeUrl, catastroFacadeResolvedAt: dto.cadastralReference ? new Date() : null };
    }
    return updated;
  }

  // ── Foto de la finca ─────────────────────────────────────────────────

  /**
   * Sustituye la foto de la finca (solo el rol A o su propia gestora). El tipo
   * se decide por el contenido, no por lo que declare el cliente; la clave de
   * almacenamiento la genera el servidor y la foto anterior se borra después
   * de guardar la nueva.
   */
  async setPhoto(
    id: string,
    file: { buffer: Buffer; size: number } | undefined,
    user: AuthenticatedUser,
  ) {
    const estate = await this.prisma.estate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, administratorId: true, photoKey: true },
    });
    if (!estate) throw new NotFoundException(`Finca ${id} no encontrada.`);
    this.assertGestoraOrAdmin(estate, user);
    if (!file || file.size === 0) throw new BadRequestException('Falta la foto.');
    if (file.size > ESTATE_PHOTO_MAX_BYTES) {
      throw new BadRequestException(
        `La foto supera el máximo de ${ESTATE_PHOTO_MAX_BYTES / (1024 * 1024)} MB.`,
      );
    }
    const type = detectImageType(file.buffer);
    if (!type) throw new BadRequestException('La foto debe ser una imagen JPG, PNG o WebP.');

    const key = await this.storage.put(`estates/${id}/photo`, `photo.${type.extension}`, file.buffer);
    let updated;
    try {
      updated = await this.prisma.estate.update({
        where: { id },
        data: { photoKey: key, photoContentType: type.contentType, photoUpdatedAt: new Date() },
        omit: ESTATE_PRIVATE_OMIT,
      });
    } catch (error) {
      await this.storage.delete(key); // sin fila que la apunte, el fichero sobra
      throw error;
    }
    if (estate.photoKey) await this.storage.delete(estate.photoKey);
    return updated;
  }

  /** Quita la foto subida (la finca vuelve a la fachada del Catastro, si la hay). */
  async removePhoto(id: string, user: AuthenticatedUser) {
    const estate = await this.prisma.estate.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, administratorId: true, photoKey: true },
    });
    if (!estate) throw new NotFoundException(`Finca ${id} no encontrada.`);
    this.assertGestoraOrAdmin(estate, user);
    const updated = await this.prisma.estate.update({
      where: { id },
      data: { photoKey: null, photoContentType: null, photoUpdatedAt: null },
      omit: ESTATE_PRIVATE_OMIT,
    });
    if (estate.photoKey) await this.storage.delete(estate.photoKey);
    return updated;
  }

  /** La foto de la finca, para quien tenga acceso a ella (gestión o propietarios). */
  async getPhoto(id: string, user: AuthenticatedUser): Promise<{ content: Buffer; contentType: string }> {
    this.estateAccess.assertAccess(id, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id, deletedAt: null },
      select: { photoKey: true, photoContentType: true },
    });
    if (!estate?.photoKey || !estate.photoContentType) {
      throw new NotFoundException('Esta finca no tiene foto subida.');
    }
    return { content: await this.storage.get(estate.photoKey), contentType: estate.photoContentType };
  }
}
