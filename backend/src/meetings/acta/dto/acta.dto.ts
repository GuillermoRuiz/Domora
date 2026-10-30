import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * Genera (o vuelve a congelar) el borrador canónico del acta. Los tres datos de la reunión son
 * los que Domora no puede deducir: los confirma la gestora aquí y quedan guardados en la junta.
 */
export class GenerateActaDto {
  @IsOptional()
  @IsDateString()
  actualStartAt?: string;

  @IsOptional()
  @IsDateString()
  actualEndAt?: string;

  @IsOptional()
  @IsIn(['primera', 'segunda'])
  effectiveConvocation?: 'primera' | 'segunda';

  /** Congelar de nuevo los datos de la junta aunque ya exista un borrador. */
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}

export class ActaItemEditDto {
  @IsString()
  @MaxLength(100)
  id!: string;

  /** Desarrollo del punto. Vacío = sin desarrollo. */
  @IsString()
  @MaxLength(6000)
  narrative!: string;
}

/**
 * Edición de los textos del acta. Solo los bloques redactables: lo factual (fechas, votos,
 * propiedades, coeficientes, resultados) sale siempre del modelo y no se puede escribir aquí.
 */
export class SaveActaEditsDto {
  /** Versión sobre la que se editó: evita pisar una versión más reciente. */
  @IsString()
  @MaxLength(100)
  baseVersionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  introduction?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  observations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(6000)
  nextSteps?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ActaItemEditDto)
  items?: ActaItemEditDto[];
}

/** Campos de texto que acompañan al archivo al subir un acta existente (multipart: llegan como texto). */
export class UploadActaDto {
  /** `true`: el archivo ya está firmado. `false`: falta firmarlo en Domora. */
  @IsIn(['true', 'false'])
  alreadySigned!: 'true' | 'false';
}
