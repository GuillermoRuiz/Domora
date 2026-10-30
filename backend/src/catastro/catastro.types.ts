import type { OwnerPropertyType, ViaType } from '../prisma/client';

/**
 * Unidad de una parcela catastral ya normalizada (strings del Catastro →
 * tipos de Domora). Es lo que ve el gestor en la pantalla previa a importar y
 * lo que vuelve editado en `POST .../catastro/import`.
 */
export interface CatastroUnit {
  /** Referencia catastral de la unidad (20 caracteres). */
  cadastralReference: string;
  /** Tipo sugerido a partir del uso catastral — el gestor puede cambiarlo. */
  type: OwnerPropertyType;
  /** Uso catastral tal cual lo devuelve el servicio (p. ej. "Residencial"). */
  use: string | null;
  viaType: ViaType | null;
  viaName: string | null;
  streetNumber: string | null;
  streetNumberSuffix: string | null;
  block: string | null;
  staircase: string | null;
  floor: string | null;
  door: string | null;
  postalCode: string | null;
  municipality: string | null;
  province: string | null;
  /** Superficie construida en m² (`debi.sfc`). */
  builtAreaM2: number | null;
  /** Coeficiente de participación en % (`debi.cpt`), redondeado a 2 decimales. */
  participationQuota: number | null;
}

/** Resultado de leer una parcela (lista de unidades + su referencia de 14). */
export interface CatastroParcel {
  /** Referencia de la parcela (14 caracteres): los 14 primeros de la de cualquiera de sus unidades. */
  parcelReference: string;
  units: CatastroUnit[];
  /** Avisos de calidad de los datos leídos (p. ej. inmueble rústico). */
  warnings: string[];
}

export interface CatastroProvince {
  code: string;
  name: string;
}

export interface CatastroStreet {
  /** Sigla del tipo de vía del Catastro (CL, AV, PZ…). */
  sigla: string;
  name: string;
}

/** Categoría de fallo → código HTTP en el servicio. */
export type CatastroErrorKind = 'not_found' | 'invalid' | 'unavailable';

export class CatastroError extends Error {
  constructor(
    readonly kind: CatastroErrorKind,
    message: string,
    /** Código de error del Catastro (`lerr[].cod`), si lo hubo. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'CatastroError';
  }
}
