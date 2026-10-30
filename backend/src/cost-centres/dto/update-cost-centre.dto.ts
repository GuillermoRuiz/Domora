import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';

const STATUSES = ['Activo', 'Archivado'] as const;

export class UpdateCostCentreDto {
  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @OptionalButNotNull()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
