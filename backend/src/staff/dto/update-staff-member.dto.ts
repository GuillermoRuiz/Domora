import {
  IsEmail,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';

const CONTRACT_TYPES = [
  'Indefinido',
  'Temporal',
  'Obra y servicio',
  'Autónomo',
] as const;
const STATUSES = ['Activo', 'Baja'] as const;

export class UpdateStaffMemberDto {
  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  nationalId?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @OptionalButNotNull()
  @IsIn(CONTRACT_TYPES)
  contractType?: (typeof CONTRACT_TYPES)[number];

  @OptionalButNotNull()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  schedule?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  monthlyCost?: number;

  @OptionalButNotNull()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}
