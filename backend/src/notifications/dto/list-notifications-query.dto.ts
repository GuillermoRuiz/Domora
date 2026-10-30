import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class ListNotificationsQueryDto {
  /** Solo los no leídos. Llega como texto en la query string ("true"/"false"). */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Paginación por cursor: avisos anteriores a esta fecha (ISO). */
  @IsOptional()
  @IsISO8601()
  before?: string;
}
