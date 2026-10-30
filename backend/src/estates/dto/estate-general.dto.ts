import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Marks or unmarks one person of a property as a key contact of the estate. */
export class SetKeyContactDto {
  @IsUUID() propertyId!: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() externalOwnerId?: string;
  @IsBoolean() keyContact!: boolean;
}
