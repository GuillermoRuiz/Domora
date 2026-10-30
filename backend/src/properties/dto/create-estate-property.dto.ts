import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { OwnerPropertyType, ViaType } from '../../prisma/client';

const PROPERTY_TYPES: OwnerPropertyType[] = [
  'Piso',
  'Casa',
  'Parking',
  'Trastero',
  'Local',
];

const VIA_TYPES: ViaType[] = [
  'Calle',
  'Avenida',
  'Plaza',
  'Paseo',
  'Camino',
  'Carretera',
];

/**
 * Alta DIRECTA de una propiedad dentro de una finca ya gestionada —
 * a diferencia de CreatePropertyDto (properties.dto.ts), que es el alta de
 * autoservicio de un rol C y siempre crea la propiedad desvinculada
 * (requiere una AdhesionRequest aprobada después). Acá la gestora YA
 * administra la finca, así que no hace falta ese rodeo: se fija
 * `estateId`/`administratorId` en el momento, sin titular todavía.
 */
export class CreateEstatePropertyDto {
  @IsIn(PROPERTY_TYPES)
  type!: OwnerPropertyType;

  @IsOptional()
  @IsIn(VIA_TYPES)
  viaType?: ViaType;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  viaName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  streetNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  staircase?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  door?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  municipality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  province?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quotaMonthly?: number;

  /**
   * Coeficiente de participación en la finca (%, 0-100, hasta 2 decimales)
   * — mismo rango que el CHECK `chk_property_participation_quota` de la
   * migración. Antes solo lo escribía el importador.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  participationQuota?: number;

  /** Superficie construida (m²). Antes solo la escribía la importación del Catastro. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  builtAreaM2?: number;
}
