import type { OwnerPropertyType, ViaType } from '../prisma/client';
import {
  CatastroError,
  type CatastroParcel,
  type CatastroProvince,
  type CatastroStreet,
  type CatastroUnit,
} from './catastro.types';

/**
 * Normalización de las respuestas JSON de los servicios web libres del
 * Catastro. Funciones puras (sin red) para poder probarlas con respuestas
 * reales grabadas (`fixtures/`).
 *
 * Particularidades del servicio que este fichero absorbe:
 *  - todo llega como string, con coma decimal en `cpt` y punto de miles en
 *    `sfc` ("3.276");
 *  - un elemento único puede llegar como objeto en vez de como array;
 *  - los errores llegan con HTTP 200 dentro del cuerpo (`lerr`);
 *  - una parcela sin división horizontal usa marcadores en lugar de datos
 *    (escalera "T", planta "OD", puerta "OS");
 *  - una consulta de un solo inmueble devuelve `bico`, no `lrcdnp`.
 */

// ── Formas crudas del servicio (solo lo que se lee; todo opcional) ─────────

type OneOrMany<T> = T | T[];

interface RawRc {
  pc1?: string;
  pc2?: string;
  car?: string;
  cc1?: string;
  cc2?: string;
}

interface RawLoint {
  bq?: string;
  es?: string;
  pt?: string;
  pu?: string;
}

interface RawDt {
  nm?: string;
  np?: string;
  locs?: {
    lous?: {
      lourb?: {
        dir?: { tv?: string; nv?: string; pnp?: string; plp?: string };
        loint?: RawLoint;
        dp?: string;
      };
    };
  };
}

interface RawDebi {
  luso?: string;
  sfc?: string;
  cpt?: string;
}

interface RawUnitEntry {
  rc?: RawRc;
  dt?: RawDt;
  debi?: RawDebi;
}

interface RawError {
  cod?: string | number;
  des?: string;
}

interface RawResult {
  control?: { cuerr?: number | string };
  lerr?: OneOrMany<RawError>;
  lrcdnp?: { rcdnp?: OneOrMany<RawUnitEntry> };
  bico?: {
    bi?: { idbi?: { rc?: RawRc }; dt?: RawDt; debi?: RawDebi };
    finca?: { ltp?: string };
  };
  provinciero?: { prov?: OneOrMany<{ cpine?: string; np?: string }> };
  municipiero?: { muni?: OneOrMany<{ nm?: string }> };
  callejero?: {
    calle?: OneOrMany<{ dir?: { tv?: string; nv?: string } }>;
  };
}

const PLACEHOLDER_STAIRCASE = 'T';
const PLACEHOLDER_FLOOR = 'OD';
const PLACEHOLDER_DOOR = 'OS';

/** Objeto único o array → siempre array. */
export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** El servicio manda strings, pero por defensa se aceptan también números. */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

/**
 * "2,150000" → 2.15 · "3.276" → 3276 · "41" → 41. El Catastro no usa punto
 * decimal: el punto es separador de miles.
 */
export function parseSpanishNumber(value: unknown): number | null {
  const cleaned = text(value).trim().replace(/\./g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

/** "ALCALA DE HENARES" → "Alcala de Henares" (el Catastro devuelve MAYÚSCULAS sin tildes). */
export function titleCase(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return v
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

/**
 * Siglas de tipo de vía del Catastro (Anexo II de la guía de servicios web).
 * Las que no se reconocen caen en `Otro`: el dato no se pierde, solo se
 * clasifica de forma genérica.
 */
const VIA_TYPES: Record<string, ViaType> = {
  CL: 'Calle',
  AV: 'Avenida',
  PZ: 'Plaza',
  PS: 'Paseo',
  CM: 'Camino',
  CR: 'Carretera',
  TR: 'Travesia',
  PJ: 'Pasaje',
  RD: 'Ronda',
  GL: 'Glorieta',
  VI: 'Via',
  PG: 'Poligono',
  UR: 'UrbanizacionVia',
  LG: 'Lugar',
};

export function mapViaType(sigla: string | null | undefined): ViaType | null {
  const s = sigla?.trim().toUpperCase();
  if (!s) return null;
  return VIA_TYPES[s] ?? 'Otro';
}

/** Quita tildes y pasa a minúsculas para comparar usos catastrales. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Uso catastral → tipo de propiedad de Domora. `Almacen-Estacionamiento`
 * agrupa garajes y trasteros (la lista no los distingue; harían falta las
 * `lcons` de cada unidad, una llamada más por unidad): se sugiere `Parking`
 * y el gestor lo corrige en la pantalla previa.
 */
export function mapPropertyType(
  use: string | null | undefined,
  undivided: boolean,
): OwnerPropertyType {
  const u = use ? fold(use) : '';
  if (u.includes('residencial')) return undivided ? 'Casa' : 'Piso';
  if (u.includes('almacen') || u.includes('estacionamiento')) return 'Parking';
  return 'Local';
}

/** "00" → "Bajo" · "01" → "1" · "-1" → "-1" · "OD" (marcador) → null. */
function normalizeFloor(pt: string | undefined): string | null {
  const v = pt?.trim();
  if (!v || v.toUpperCase() === PLACEHOLDER_FLOOR) return null;
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n === 0 ? 'Bajo' : String(n);
  }
  return v;
}

function clean(value: unknown, placeholder?: string): string | null {
  const v = text(value).trim();
  if (v === '') return null;
  if (placeholder && v.toUpperCase() === placeholder) return null;
  return v;
}

/**
 * Extrae el objeto de resultado (`consulta_dnprcResult`, `..._dnplocResult`,
 * `..._callejeroResult`…) y lanza `CatastroError` si trae errores. Los
 * errores llegan con HTTP 200 — sin esto un "no existe" parecería un éxito
 * sin datos.
 */
function unwrapResult(json: unknown): RawResult {
  const root: unknown =
    json && typeof json === 'object' ? Object.values(json)[0] : null;
  if (!root || typeof root !== 'object') {
    throw new CatastroError(
      'unavailable',
      'Respuesta del Catastro con un formato inesperado.',
    );
  }
  const result = root as RawResult;
  const errors = asArray(result.lerr);
  if (errors.length > 0 || Number(result.control?.cuerr) > 0) {
    const first = errors[0] ?? {};
    const code = first.cod != null ? text(first.cod) : undefined;
    const message = first.des ? text(first.des) : 'Error del Catastro.';
    // 3 = longitud de la RC, 9/42 = parámetros mal formados.
    const invalid = code === '3' || code === '9' || code === '42';
    throw new CatastroError(invalid ? 'invalid' : 'not_found', message, code);
  }
  return result;
}

interface RawIdentification extends RawUnitEntry {
  /** Parcela sin división horizontal (vivienda unifamiliar / inmueble único). */
  undivided: boolean;
}

function buildRc(rc: RawRc | undefined): string | null {
  if (!rc?.pc1 || !rc?.pc2) return null;
  return `${rc.pc1}${rc.pc2}${rc.car ?? ''}${rc.cc1 ?? ''}${rc.cc2 ?? ''}`;
}

function mapUnit(
  raw: RawIdentification,
  warnings: string[],
): CatastroUnit | null {
  const full = buildRc(raw.rc);
  if (!full) return null;

  const urban = raw.dt?.locs?.lous?.lourb;
  if (!urban) {
    // Inmueble rústico (`lors`: polígono/parcela) — sin escalera/planta/puerta.
    warnings.push(
      `El inmueble ${full} no tiene dirección urbana (¿rústico?): se importa sin datos de vía.`,
    );
  }
  const dir = urban?.dir ?? {};
  const loint = urban?.loint ?? {};

  const number = clean(dir.pnp);
  const quota = parseSpanishNumber(raw.debi?.cpt);

  return {
    cadastralReference: full,
    type: mapPropertyType(raw.debi?.luso, raw.undivided),
    use: clean(raw.debi?.luso),
    viaType: mapViaType(dir.tv),
    viaName: titleCase(dir.nv),
    streetNumber: number && number !== '0' ? number : null,
    streetNumberSuffix: clean(dir.plp),
    block: clean(loint.bq),
    staircase: clean(loint.es, PLACEHOLDER_STAIRCASE),
    floor: normalizeFloor(loint.pt),
    door: clean(loint.pu, PLACEHOLDER_DOOR),
    postalCode: clean(urban?.dp),
    municipality: titleCase(raw.dt?.nm),
    province: titleCase(raw.dt?.np),
    builtAreaM2: parseSpanishNumber(raw.debi?.sfc),
    participationQuota: quota == null ? null : Math.round(quota * 100) / 100,
  };
}

/**
 * Respuesta de `Consulta_DNPRC` / `Consulta_DNPLOC` → parcela normalizada.
 *
 * - Varios inmuebles: `lrcdnp.rcdnp[]` (una entrada por unidad).
 * - Un solo inmueble: `bico` (`bi` + `finca` + `lcons`). Si la parcela no
 *   tiene división horizontal (`finca.ltp`) es una vivienda unifamiliar /
 *   inmueble único.
 */
export function parseParcel(json: unknown): CatastroParcel {
  const root = unwrapResult(json);
  const warnings: string[] = [];
  const units: CatastroUnit[] = [];

  if (root.lrcdnp) {
    for (const item of asArray(root.lrcdnp.rcdnp)) {
      const unit = mapUnit({ ...item, undivided: false }, warnings);
      if (unit) units.push(unit);
    }
  } else if (root.bico?.bi) {
    const { bi, finca } = root.bico;
    // El texto NO es simétrico ("Parcela con varios inmuebles (division
    // horizontal)" vs "Parcela construida sin división horizontal"), así que
    // solo se considera unifamiliar cuando dice explícitamente "sin división".
    const undivided = /sin divisi[oó]n horizontal/i.test(text(finca?.ltp));
    const unit = mapUnit(
      { rc: bi.idbi?.rc, dt: bi.dt, debi: bi.debi, undivided },
      warnings,
    );
    if (unit) units.push(unit);
  }

  if (units.length === 0) {
    throw new CatastroError(
      'not_found',
      'El Catastro no devolvió ningún inmueble para esa consulta.',
    );
  }

  const parcelReference = units[0].cadastralReference.slice(0, 14);
  return { parcelReference, units, warnings };
}

export function parseProvinces(json: unknown): CatastroProvince[] {
  const root = unwrapResult(json);
  return asArray(root.provinciero?.prov).map((p) => ({
    code: text(p.cpine),
    name: text(p.np),
  }));
}

/** Solo los nombres: es lo único que necesita el autocompletado del formulario. */
export function parseMunicipalities(json: unknown): string[] {
  const root = unwrapResult(json);
  return asArray(root.municipiero?.muni).map((m) => text(m.nm));
}

export function parseStreets(json: unknown): CatastroStreet[] {
  const root = unwrapResult(json);
  return asArray(root.callejero?.calle).map((c) => ({
    sigla: text(c.dir?.tv),
    name: text(c.dir?.nv),
  }));
}
