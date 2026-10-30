import type { OwnerPropertyType } from '../../prisma/client';
import { parseSpanishDecimal, type ValidatedRow } from './parsing.util';

export interface PropertyImportRow {
  ref?: string;
  /** Siempre presente tras validar — 'Piso' por defecto si el origen no trae un tipo reconocible. */
  type: OwnerPropertyType;
  participationQuota?: number;
  floor?: string;
  door?: string;
  quotaMonthly?: number;
}

const PROPERTY_TYPES: OwnerPropertyType[] = ['Piso', 'Casa', 'Parking', 'Trastero', 'Local'];
const DEFAULT_PROPERTY_TYPE: OwnerPropertyType = 'Piso';

function matchPropertyType(raw: string): OwnerPropertyType | null {
  const normalized = raw.trim().toLowerCase();
  return PROPERTY_TYPES.find((t) => t.toLowerCase() === normalized) ?? null;
}

/**
 * `mappedRow` ya viene con los campos destino como clave (ver
 * `imports.service.ts`'s `mapRow()`), no las cabeceras originales del
 * fichero — esta función no sabe nada de Gesfincas ni de presets, solo
 * valida la forma del dato ya mapeado.
 */
export function validatePropertyRow(
  mappedRow: Record<string, string>,
  rowNumber: number,
): ValidatedRow<PropertyImportRow> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const data: Partial<PropertyImportRow> = {};

  const ref = mappedRow['ref']?.trim();
  if (ref) {
    data.ref = ref;
  } else {
    warnings.push('Sin referencia de unidad — se generará una automáticamente.');
  }

  const typeRaw = mappedRow['type']?.trim();
  if (typeRaw) {
    const matched = matchPropertyType(typeRaw);
    if (matched) {
      data.type = matched;
    } else {
      data.type = DEFAULT_PROPERTY_TYPE;
      warnings.push(`Tipo "${typeRaw}" no reconocido — se importó como "${DEFAULT_PROPERTY_TYPE}".`);
    }
  } else {
    data.type = DEFAULT_PROPERTY_TYPE;
    warnings.push(`Sin tipo de unidad en el origen — se importó como "${DEFAULT_PROPERTY_TYPE}".`);
  }

  const quotaRaw = mappedRow['participationQuota']?.trim();
  if (quotaRaw) {
    const n = parseSpanishDecimal(quotaRaw);
    if (n === null) {
      errors.push(`Coeficiente de participación inválido: "${quotaRaw}".`);
    } else if (n < 0 || n > 100) {
      errors.push(`Coeficiente de participación fuera de rango (0-100): ${n}.`);
    } else {
      data.participationQuota = n;
    }
  } else {
    warnings.push('Sin coeficiente de participación en el origen.');
  }

  const floor = mappedRow['floor']?.trim();
  if (floor) data.floor = floor;

  const door = mappedRow['door']?.trim();
  if (door) data.door = door;

  const quotaMonthlyRaw = mappedRow['quotaMonthly']?.trim();
  if (quotaMonthlyRaw) {
    const n = parseSpanishDecimal(quotaMonthlyRaw);
    if (n === null) {
      errors.push(`Cuota mensual inválida: "${quotaMonthlyRaw}".`);
    } else if (n < 0) {
      errors.push(`Cuota mensual negativa: ${n}.`);
    } else {
      data.quotaMonthly = n;
    }
  }

  return {
    rowNumber,
    ok: errors.length === 0,
    // `type` siempre queda seteado más arriba (matched, default, o default con aviso).
    data: errors.length === 0 ? (data as PropertyImportRow) : undefined,
    errors,
    warnings,
  };
}
