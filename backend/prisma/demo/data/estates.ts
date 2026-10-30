import { type Rng, randInt } from '../lib/rng';

/** Tipos de unidad que admite `CreateEstatePropertyDto`. */
export type UnitKind = 'Piso' | 'Parking' | 'Local';

export interface UnitSpec {
  /** Referencia interna de la unidad (única por finca): "3B", "P03", "L2". */
  ref: string;
  kind: UnitKind;
  floor?: string;
  door?: string;
  /** Superficie construida (m²), 2 decimales como máximo. */
  m2: number;
}

export type EstateKey = 'val' | 'mad' | 'valb';

export interface EntidadBancaria {
  code: string;
  name: string;
  bic: string;
}

/** Entidades reales (código de 4 dígitos coincide con lib/iban SPANISH_BANK_CODES). */
export const BANKS: Record<string, EntidadBancaria> = {
  '2100': { code: '2100', name: 'CaixaBank', bic: 'CAIXESBBXXX' },
  '0049': { code: '0049', name: 'Banco Santander', bic: 'BSCHESMMXXX' },
  '0182': { code: '0182', name: 'BBVA', bic: 'BBVAESMMXXX' },
  '0081': { code: '0081', name: 'Banco Sabadell', bic: 'BSABESBBXXX' },
  '2038': { code: '2038', name: 'CaixaBank (ex Bankia)', bic: 'CAHMESMMXXX' },
  '0128': { code: '0128', name: 'Bankinter', bic: 'BKBKESMMXXX' },
  '2085': { code: '2085', name: 'Ibercaja', bic: 'CAZRES2ZXXX' },
  '3058': { code: '3058', name: 'Cajamar', bic: 'CCRIES2AXXX' },
};

export interface EstateSpec {
  key: EstateKey;
  /** Nombre de la comunidad: "Comunidad de Propietarios <dirección>". */
  name: string;
  viaType: 'Calle' | 'Avenida';
  viaName: string;
  streetNumber: string;
  postalCode: string;
  municipality: string;
  province: string;
  color: string;
  /** Objetivo del fondo de reserva (€). */
  reserveTarget: number;
  /** Presupuesto ordinario MENSUAL (céntimos); F2 lo usa para los recibos. */
  monthlyBudgetCents: number;
  /** Código de entidad de la cuenta de la comunidad. */
  bankCode: string;
  /** Meses desde el alta de la finca en Domora hasta el ancla. */
  ageMonths: number;
  /** Cobro por remesa SEPA (fincas 1 y 2) o transferencia manual (finca 3). */
  usesSepa: boolean;
}

export const ESTATE_SPECS: readonly EstateSpec[] = [
  {
    key: 'val',
    name: 'Comunidad de Propietarios Colón 24',
    viaType: 'Calle',
    viaName: 'Colón',
    streetNumber: '24',
    postalCode: '46004',
    municipality: 'Valencia',
    province: 'Valencia',
    color: '#2F6F8F',
    reserveTarget: 18_000,
    monthlyBudgetCents: 540_000,
    bankCode: '2100',
    ageMonths: 14,
    usesSepa: true,
  },
  {
    key: 'mad',
    name: 'Comunidad de Propietarios Ponzano 45',
    viaType: 'Calle',
    viaName: 'de Ponzano',
    streetNumber: '45',
    postalCode: '28003',
    municipality: 'Madrid',
    province: 'Madrid',
    color: '#B5651D',
    reserveTarget: 7_500,
    monthlyBudgetCents: 195_000,
    bankCode: '0049',
    ageMonths: 13,
    usesSepa: true,
  },
  {
    key: 'valb',
    name: 'Comunidad de Propietarios Cuba 18',
    viaType: 'Calle',
    viaName: 'de Cuba',
    streetNumber: '18',
    postalCode: '46006',
    municipality: 'Valencia',
    province: 'Valencia',
    color: '#4C7A4F',
    reserveTarget: 2_400,
    monthlyBudgetCents: 72_000,
    bankCode: '3058',
    ageMonths: 12,
    usesSepa: false,
  },
];

/** Gestora: datos de contacto y facturación (la crea F0 con AdminsService). */
export const GESTORA = {
  name: 'Administración de Fincas Levante S.L.',
  street: 'Calle Pintor Sorolla 21, 1º',
  postalCode: '46002',
  city: 'Valencia',
  phone: '963 51 42 87',
  bankCode: '0081',
} as const;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** m² con variación determinista alrededor de una base (±2 m², 1 decimal). */
function vary(rng: Rng, base: number, spread = 20): number {
  return round1(base + randInt(rng, -spread, spread) / 10);
}

const DOORS = ['A', 'B', 'C', 'D'] as const;

/**
 * Unidades de cada finca. Cifras: Colón 24 = 28 viviendas + 8 garajes + 4
 * locales (40); Ponzano 45 = 12 + 2 + 1 (15); Cuba 18 = 6 viviendas (6).
 * Total 61.
 */
export function buildUnits(spec: EstateSpec, rng: Rng): UnitSpec[] {
  const units: UnitSpec[] = [];
  const flats = (floors: number, doors: number, bases: readonly number[]) => {
    for (let floor = 1; floor <= floors; floor++) {
      for (let i = 0; i < doors; i++) {
        const door = DOORS[i] as string;
        units.push({
          ref: `${floor}${door}`,
          kind: 'Piso',
          floor: String(floor),
          door,
          m2: vary(rng, bases[i] as number),
        });
      }
    }
  };
  const garages = (count: number, width: number) => {
    for (let n = 1; n <= count; n++) {
      units.push({
        ref: `P${String(n).padStart(width, '0')}`,
        kind: 'Parking',
        door: `Plaza ${n}`,
        m2: vary(rng, 12.5, 10),
      });
    }
  };
  const locals = (bases: readonly number[]) => {
    bases.forEach((base, i) => {
      units.push({
        ref: `L${i + 1}`,
        kind: 'Local',
        door: `Local ${i + 1}`,
        m2: vary(rng, base),
      });
    });
  };

  switch (spec.key) {
    case 'val':
      flats(7, 4, [92, 78, 105, 64]);
      garages(8, 2);
      locals([86, 64, 120, 72]);
      break;
    case 'mad':
      flats(4, 3, [98, 84, 71]);
      garages(2, 1);
      locals([68]);
      break;
    case 'valb':
      flats(3, 2, [76, 69]);
      break;
  }
  return units;
}
