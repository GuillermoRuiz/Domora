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

const CONTRACT_TYPES = [
  'Indefinido',
  'Temporal',
  'Obra y servicio',
  'Autónomo',
] as const;

export class CreateStaffMemberDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  position!: string;

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

  @IsIn(CONTRACT_TYPES)
  contractType!: (typeof CONTRACT_TYPES)[number];

  @IsISO8601()
  startDate!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  schedule?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  monthlyCost?: number;
}
