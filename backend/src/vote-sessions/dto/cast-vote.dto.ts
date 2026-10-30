import { IsArray, IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CastVoteDto {
  @IsUUID()
  propertyId!: string;

  /** single_choice. */
  @IsOptional()
  @IsInt()
  optionIndex?: number;

  /** multiple_choice. */
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  optionIndexes?: number[];

  /** Solo exigido si la sesión de voto tiene `require2fa` (Fase 2.3) — TOTP o código de respaldo. */
  @IsOptional()
  @IsString()
  @Length(4, 9)
  totpCode?: string;
}
