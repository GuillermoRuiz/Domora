import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ActaPointCommentDto {
  @IsString()
  @MaxLength(100)
  itemId!: string;

  /** Vacío = sin comentarios en ese punto. */
  @IsString()
  @MaxLength(2000)
  comments!: string;
}

/**
 * Guarda una versión del acta con los textos que escribe la gestora. Cada campo es opcional:
 * el que no llega conserva su valor actual, y un texto vacío lo borra.
 */
export class SaveActaVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  generalComments?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  nextSteps?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ActaPointCommentDto)
  pointComments?: ActaPointCommentDto[];
}
