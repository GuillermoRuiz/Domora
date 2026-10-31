import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CatastroClient } from './catastro.client';
import { CatastroFacadeService } from './catastro-facade.service';
import {
  CatastroError,
  type CatastroParcel,
  type CatastroProvince,
  type CatastroStreet,
  type CatastroUnit,
} from './catastro.types';
import type { LookupCatastroDto } from './dto/lookup-catastro.dto';
import type { ImportCatastroDto } from './dto/import-catastro.dto';

/** 24 h: los datos catastrales cambian con muy poca frecuencia y el cupo es por IP. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;
/** Tamaño de lote de inserción — mismo criterio que `commitProperties` del importador. */
const CHUNK_SIZE = 500;
/** Tolerancia al comparar la suma de coeficientes con 100 (redondeo a 2 decimales por unidad). */
const QUOTA_SUM_TOLERANCE = 0.5;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  fetchedAt: Date;
}

export interface CatastroLookupUnit extends CatastroUnit {
  /** Ya existe una propiedad de la finca con esa referencia catastral. */
  alreadyImported: boolean;
}

export interface CatastroLookupResult {
  source: {
    name: 'Dirección General del Catastro';
    parcelReference: string;
    /** Momento en que se leyó el Catastro (puede ser de la caché). */
    fetchedAt: string;
  };
  units: CatastroLookupUnit[];
  warnings: string[];
}

@Injectable()
export class CatastroService {
  private readonly cache = new Map<string, CacheEntry<unknown>>();

  constructor(
    private readonly client: CatastroClient,
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly facade: CatastroFacadeService,
  ) {}

  // ── Catálogos para autocompletar el formulario ───────────────────────────

  provinces(): Promise<CatastroProvince[]> {
    return this.guard(() =>
      this.cached('provinces', () => this.client.provinces()).then(
        (r) => r.value,
      ),
    );
  }

  municipalities(province: string, q = ''): Promise<string[]> {
    return this.guard(() => this.client.municipalities(province, q));
  }

  streets(
    province: string,
    municipality: string,
    q: string,
  ): Promise<CatastroStreet[]> {
    return this.guard(() => this.client.streets(province, municipality, q));
  }

  // ── Consulta (no escribe) ────────────────────────────────────────────────

  async lookup(
    estateId: string,
    dto: LookupCatastroDto,
    user: AuthenticatedUser,
  ): Promise<CatastroLookupResult> {
    this.estateAccess.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: { id: true },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }

    const { value: parcel, fetchedAt } = await this.guard(() =>
      this.fetchParcel(dto),
    );

    const existing = await this.prisma.property.findMany({
      where: { estateId, deletedAt: null },
      select: { cadastralReference: true },
    });
    const existingRefs = new Set(
      existing.map((p) => p.cadastralReference).filter((r): r is string => !!r),
    );

    const units: CatastroLookupUnit[] = parcel.units.map((u) => ({
      ...u,
      alreadyImported: existingRefs.has(u.cadastralReference),
    }));
    const withQuota = units.filter((u) => u.participationQuota != null);
    const quotaSum =
      Math.round(
        withQuota.reduce((acc, u) => acc + (u.participationQuota ?? 0), 0) *
          100,
      ) / 100;

    const warnings = [...parcel.warnings];
    if (withQuota.length === 0) {
      warnings.push(
        'El Catastro no informa coeficientes de participación para esta parcela.',
      );
    } else {
      if (Math.abs(quotaSum - 100) > QUOTA_SUM_TOLERANCE) {
        warnings.push(
          `Los coeficientes suman ${quotaSum}% (no 100%). Revísalos antes de importar: el coeficiente catastral puede diferir del de la escritura de división horizontal.`,
        );
      }
      if (withQuota.length < units.length) {
        warnings.push(
          `${units.length - withQuota.length} unidad(es) no traen coeficiente.`,
        );
      }
    }
    const already = units.filter((u) => u.alreadyImported).length;
    if (already > 0) {
      warnings.push(
        `${already} unidad(es) ya están importadas en esta finca y se omitirán.`,
      );
    }
    const manual = existing.filter((p) => !p.cadastralReference).length;
    if (manual > 0 && already < units.length) {
      warnings.push(
        `La finca ya tiene ${manual} propiedad(es) sin referencia catastral (creadas a mano): si son las mismas, se duplicarán al importar.`,
      );
    }

    return {
      source: {
        name: 'Dirección General del Catastro',
        parcelReference: parcel.parcelReference,
        fetchedAt: fetchedAt.toISOString(),
      },
      units,
      warnings,
    };
  }

  // ── Importación (escribe) ────────────────────────────────────────────────

  /**
   * Crea las unidades ya revisadas por el gestor. Idempotente por referencia
   * catastral: lo que ya existe en la finca se omite, así que confirmar dos
   * veces (doble clic, dos pestañas) no duplica nada. Se serializa por finca
   * con un bloqueo de fila porque no hay índice único que lo garantice (el
   * importador de ficheros pudo haber escrito referencias repetidas, y un
   * índice único rompería la migración con datos existentes).
   */
  async importUnits(
    estateId: string,
    dto: ImportCatastroDto,
    user: AuthenticatedUser,
  ): Promise<{ created: number; skipped: number }> {
    this.estateAccess.assertAccess(estateId, user);
    const now = new Date();
    // La fecha de acceso que citamos no puede ser futura (dato del cliente).
    const requested = dto.fetchedAt ? new Date(dto.fetchedAt) : now;
    const syncedAt = requested > now ? now : requested;

    const result = await this.prisma.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM estates
          WHERE id = ${estateId}::uuid AND deleted_at IS NULL
          FOR UPDATE`;
        if (locked.length === 0) {
          throw new NotFoundException(`Finca ${estateId} no encontrada.`);
        }
        const estate = await tx.estate.findFirstOrThrow({
          where: { id: estateId },
          select: {
            administratorId: true,
            province: true,
            postalCode: true,
            cadastralReference: true,
          },
        });

        const existing = await tx.property.findMany({
          where: {
            estateId,
            deletedAt: null,
            cadastralReference: {
              in: dto.units.map((u) => u.cadastralReference),
            },
          },
          select: { cadastralReference: true },
        });
        const seen = new Set(
          existing.map((p) => p.cadastralReference as string),
        );
        const toCreate = dto.units.filter((u) => {
          if (seen.has(u.cadastralReference)) return false;
          seen.add(u.cadastralReference);
          return true;
        });

        for (let i = 0; i < toCreate.length; i += CHUNK_SIZE) {
          await tx.property.createMany({
            data: toCreate.slice(i, i + CHUNK_SIZE).map((u) => ({
              estateId,
              administratorId: estate.administratorId,
              type: u.type,
              status: 'Vacio' as const,
              viaType: u.viaType ?? null,
              viaName: u.viaName ?? null,
              streetNumber: u.streetNumber ?? null,
              streetNumberSuffix: u.streetNumberSuffix ?? null,
              block: u.block ?? null,
              staircase: u.staircase ?? null,
              floor: u.floor ?? null,
              door: u.door ?? null,
              postalCode: u.postalCode ?? null,
              municipality: u.municipality ?? null,
              province: u.province ?? null,
              country: 'ES',
              cadastralReference: u.cadastralReference,
              participationQuota: u.participationQuota ?? null,
              builtAreaM2: u.builtAreaM2 ?? null,
              catastroSyncedAt: syncedAt,
            })),
          });
        }

        // Enriquecer la finca solo donde no tenía dato: nunca se pisa lo que
        // el gestor ya escribió.
        const first = dto.units[0];
        const estatePatch = {
          ...(estate.cadastralReference == null && dto.parcelReference
            ? { cadastralReference: dto.parcelReference }
            : {}),
          ...(estate.province == null && first.province
            ? { province: first.province }
            : {}),
          ...(estate.postalCode == null && first.postalCode
            ? { postalCode: first.postalCode }
            : {}),
        };
        if (Object.keys(estatePatch).length > 0) {
          await tx.estate.update({
            where: { id: estateId },
            data: estatePatch,
          });
        }

        if (toCreate.length > 0) {
          // Una sola entrada resumen (no una por unidad: un edificio grande
          // inundaría el feed de actividad). En altas masivas el sujeto es la
          // finca.
          await tx.activityLogEntry.create({
            data: {
              actorUserId: user.id,
              subjectType: 'property',
              subjectId: estateId,
              verb: 'created',
              summary: `Importadas ${toCreate.length} propiedades desde el Catastro`,
              occurredAt: now,
              estateId,
              propertyId: null,
            },
          });
        }

        return {
          created: toCreate.length,
          skipped: dto.units.length - toCreate.length,
        };
      },
      // 1000 filas en lotes de 500 caben de sobra, pero el timeout por defecto
      // de Prisma (5 s) es justo si la BD va cargada.
      { timeout: 30_000 },
    );
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId, deletedAt: null },
      select: { cadastralReference: true },
    });
    if (estate?.cadastralReference)
      await this.facade.refreshEstate(estateId, estate.cadastralReference);
    return result;
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private fetchParcel(
    dto: LookupCatastroDto,
  ): Promise<CacheEntry<CatastroParcel>> {
    if (dto.refCat) {
      // Con una RC de 18/20 caracteres el servicio devolvería solo esa
      // unidad; siempre se lee la parcela (14) para listar el edificio entero.
      const parcelRef = dto.refCat.trim().toUpperCase().slice(0, 14);
      return this.cached(`rc:${parcelRef}`, () =>
        this.client.byReference(parcelRef),
      );
    }
    const { provincia, municipio, sigla, calle, numero } = dto;
    if (!provincia || !municipio || !sigla || !calle || !numero) {
      throw new BadRequestException(
        'Indica una referencia catastral o la dirección completa (provincia, municipio, tipo de vía, calle y número).',
      );
    }
    const key = `addr:${[provincia, municipio, sigla, calle, numero]
      .map((s) => s.trim().toUpperCase())
      .join('|')}`;
    return this.cached(key, () =>
      this.client.byAddress({ provincia, municipio, sigla, calle, numero }),
    );
  }

  private async cached<T>(
    key: string,
    load: () => Promise<T>,
  ): Promise<CacheEntry<T>> {
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expiresAt > Date.now()) return hit;
    const fetchedAt = new Date();
    const entry: CacheEntry<T> = {
      value: await load(),
      expiresAt: fetchedAt.getTime() + CACHE_TTL_MS,
      fetchedAt,
    };
    // Solo se cachean éxitos (un error lanza antes de llegar aquí). Tope
    // simple: al llenarse se descarta la entrada más antigua (orden de inserción).
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  /** `CatastroError` → excepción HTTP con el mensaje del propio servicio. */
  private async guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (!(err instanceof CatastroError)) throw err;
      if (err.kind === 'not_found') throw new NotFoundException(err.message);
      if (err.kind === 'invalid') throw new BadRequestException(err.message);
      throw new ServiceUnavailableException(err.message);
    }
  }
}
