import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OptionalButNotNull } from '../../common/optional-not-null.decorator';
import type { CorrectiveActionStatus } from '../../prisma/client';

const STATUSES: CorrectiveActionStatus[] = [
  'abierta',
  'en_progreso',
  'cerrada',
  'vencida',
];

export class UpdateCorrectiveActionDto {
  @OptionalButNotNull()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @OptionalButNotNull()
  @IsInt()
  @Min(1)
  @Max(3)
  priority?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @OptionalButNotNull()
  @IsIn(STATUSES)
  status?: CorrectiveActionStatus;

  @IsOptional()
  @IsUUID()
  assigneeUserId?: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;
}
