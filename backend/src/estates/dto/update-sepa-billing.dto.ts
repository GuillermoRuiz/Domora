import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateSepaBillingDto {
  /** Creditor Identifier del acreedor SEPA — formato ES + 2 dígitos + ZZZ/entidad + 7 dígitos (16 chars). */
  @IsOptional()
  @IsString()
  @Length(1, 16)
  creditorId?: string;

  @IsOptional()
  @IsString()
  @Length(15, 34)
  creditorIban?: string;

  @IsOptional()
  @IsString()
  @Length(8, 11)
  creditorBic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  creditorPostalAddress?: string;
}
