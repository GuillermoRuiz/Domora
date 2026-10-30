import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { LeadOrigin, LeadStatus, PlanTier } from '../../prisma/client';

const PLANS = Object.values(PlanTier);
const ORIGINS = Object.values(LeadOrigin);
const STATUSES = Object.values(LeadStatus);

/** Fields shared by create and update. `null` clears an optional field on update. */
class LeadFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsEmail()
  @MaxLength(200)
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(PLANS)
  planOfInterest?: PlanTier | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  nextAction?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  nextActionAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class CreateLeadDto extends LeadFieldsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  /** `solicitud_alta` is reserved for leads created from a community request. */
  @IsIn(ORIGINS)
  origin!: LeadOrigin;
}

export class UpdateLeadDto extends LeadFieldsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(ORIGINS)
  origin?: LeadOrigin;

  /** `convertido` is only reached through the conversion. */
  @IsOptional()
  @IsIn(STATUSES)
  status?: LeadStatus;
}

export class CreateFollowUpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  /** Defaults to now. */
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

/** Despacho data for the conversion: whatever is not sent comes from the lead. */
export class ConvertLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  cif!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(PLANS)
  plan?: PlanTier;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class SetNextActionDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(300)
  nextAction?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  nextActionAt?: string | null;
}
