import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Tipo de inspección personalizado de una finca — el catálogo global (estateId NULL) solo se siembra por migración. */
export class CreateInspectionTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  legalBasis?: string;

  @IsOptional()
  @IsBoolean()
  requiresOca?: boolean;
}
