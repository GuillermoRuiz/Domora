import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class GenerateReceiptsDto {
  /** Periodo en formato 'YYYY-MM' (p. ej. '2026-07'). */
  @Matches(/^\d{4}-\d{2}$/)
  periodKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  monthAbbrev?: string;
}
