import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const APPOINTABLE_OFFICE_ROLES = [
  'PRESIDENT',
  'VICE_PRESIDENT',
] as const;
export type AppointableOfficeRole = (typeof APPOINTABLE_OFFICE_ROLES)[number];

export class AppointOfficeTermDto {
  /** Omitted = PRESIDENT, the only role the endpoint accepted before. */
  @IsOptional() @IsIn(APPOINTABLE_OFFICE_ROLES) role?: AppointableOfficeRole;
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startsAt!: string;
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsAt?: string;
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() externalOwnerId?: string;
  @IsOptional() @IsUUID() appointedByMeetingId?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  holderNameSnapshot?: string;
}

export class EndOfficeTermDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  endsAt!: string;
}
