import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Autocompletado de municipios: `GET catastro/municipalities?province=&q=`. */
export class MunicipalitiesQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** Autocompletado de calles: `GET catastro/streets?province=&municipality=&q=`. */
export class StreetsQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  province!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  municipality!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;
}
