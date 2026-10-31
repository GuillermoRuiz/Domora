import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MembershipRoleType,
  OwnerPropertyType,
  ViaType,
} from '../../prisma/client';

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

const ROLE_TYPES: MembershipRoleType[] = [
  'Propietario',
  'Inquilino',
  'Representante',
  'Ocupante',
  'Otro',
];

export class CreatePropertyDto {
  @IsIn(PROPERTY_TYPES)
  type!: OwnerPropertyType;

  @IsIn(ROLE_TYPES)
  roleType!: MembershipRoleType;

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
  @IsString()
  @MaxLength(2)
  country?: string;

  /** Si se indica, además de crear la propiedad se abre una solicitud de adhesión a esta finca. */
  @IsOptional()
  @IsUUID()
  estateId?: string;
}

export class UpdatePropertyDto {
  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  type?: OwnerPropertyType;

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
  @IsString()
  @MaxLength(2)
  country?: string;

  /**
   * Coeficiente de participación (%, 0-100, hasta 2 decimales). `null`
   * lo borra. Este DTO también lo usa el propio propietario (rol C) sobre
   * su propiedad, pero el coeficiente es un dato legal que fija la
   * escritura de división horizontal, no algo que el vecino elija — por eso
   * `PropertiesService.update` rechaza este campo si quien llama no es la
   * gestora de la finca (o rol A).
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  participationQuota?: number | null;

  /**
   * Cuota ordinaria mensual (€). Mismo criterio que `participationQuota`:
   * la fija la junta, no el vecino — `PropertiesService.update` la rechaza
   * si quien llama no es la gestora. Sin poder editarla tras el alta, una
   * propiedad con cuota 0 quedaba fuera de `generateReceipts` para siempre.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  quotaMonthly?: number;

  /**
   * Superficie construida (m²). Mismo criterio que `participationQuota`: es
   * un dato objetivo (catastral o de la escritura), no algo que el vecino
   * edite — `PropertiesService.update` la rechaza si quien llama no es la
   * gestora.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  builtAreaM2?: number | null;
}
