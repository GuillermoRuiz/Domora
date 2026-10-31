import {
  IsIn,
  IsInt,
  IsNumber,
  Max,
  Min,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EstateType } from '../../prisma/client';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CIF_PATTERN = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/i;

/** Referencia catastral de la PARCELA: 14 caracteres alfanuméricos. */
const PARCEL_REFERENCE = /^[0-9A-Z]{14}$/;

/** Uso principal de la finca (lista cerrada: se filtra y se muestra tal cual). */
export const ESTATE_MAIN_USES = [
  'Residencial',
  'Mixto',
  'Comercial',
  'Oficinas',
  'Garajes y trasteros',
  'Otro',
] as const;

const ESTATE_TYPES: EstateType[] = [
  'Edificio',
  'Urbanizacion',
  'Garaje',
  'Trasteros',
  'Local',
];

export class CreateEstateDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(ESTATE_TYPES)
  type!: EstateType;

  @IsString()
  @MinLength(1)
  address!: string;

  @IsOptional()
  @IsString()
  streetNumber?: string;

  @IsString()
  @MinLength(1)
  location!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string | null;

  /** Referencia catastral de la parcela (14 caracteres). */
  @IsOptional()
  @Matches(PARCEL_REFERENCE, {
    message:
      'La referencia catastral de la parcela debe tener 14 caracteres (mayúsculas y dígitos).',
  })
  cadastralReference?: string | null;

  @IsNumber()
  reserveTarget!: number;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @Matches(HEX_COLOR, {
    message: 'color debe ser un hex de 6 dígitos, ej. #C8A24A',
  })
  color?: string;
}

export class UpdateEstateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(ESTATE_TYPES)
  type?: EstateType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  address?: string;

  @IsOptional()
  @IsString()
  streetNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  location?: string;

  /** Presentación de la finca en su ficha. `null` la borra. */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  postalCode?: string | null;

  /** Referencia catastral de la parcela (14 caracteres). `null` la borra. */
  @IsOptional()
  @Matches(PARCEL_REFERENCE, {
    message:
      'La referencia catastral de la parcela debe tener 14 caracteres (mayúsculas y dígitos).',
  })
  cadastralReference?: string | null;

  @IsOptional()
  @IsNumber()
  reserveTarget?: number;

  @IsOptional()
  @IsString()
  iban?: string;

  /** `null` limpia el color manual y vuelve al color derivado automáticamente. */
  @IsOptional()
  @Matches(HEX_COLOR, {
    message: 'color debe ser un hex de 6 dígitos, ej. #C8A24A',
  })
  color?: string | null;

  /**
   * NIF de la comunidad de propietarios (típicamente con letra H). Solo se
   * valida el formato, no el dígito de control: mejor aceptar un CIF que ya
   * viene de otro programa que bloquear el alta. `null` lo borra.
   */
  @IsOptional()
  @Matches(CIF_PATTERN, {
    message:
      'cif debe tener formato de CIF español: letra + 7 dígitos + control (ej. H12345678)',
  })
  cif?: string | null;

  // ── Datos generales. `null` borra cada uno. ──
  @IsOptional()
  @IsInt()
  @Min(1500)
  @Max(2100)
  yearBuilt?: number | null;

  @IsOptional()
  @IsIn(ESTATE_MAIN_USES)
  mainUse?: (typeof ESTATE_MAIN_USES)[number] | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  internalRef?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  taxRegime?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  applicableLaw?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
