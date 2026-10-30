import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateEstateOnboardingRequestDto {
  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  communityName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  communityAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  adminName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  adminEmail?: string;
}
