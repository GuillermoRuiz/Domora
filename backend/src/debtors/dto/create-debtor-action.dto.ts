import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { GestionType } from '../../prisma/client';

const GESTION_TYPES: GestionType[] = [
  'Llamada',
  'Email',
  'CartaAmistosa',
  'CartaFormal',
  'Burofax',
  'AccionJudicial',
];

export class CreateDebtorActionDto {
  @IsIn(GESTION_TYPES)
  type!: GestionType;

  @IsDateString()
  date!: string;

  @IsString()
  @MinLength(1)
  note!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  result?: string;

  /** Actuación en nombre de otro usuario (representación) — FK lógica. */
  @IsOptional()
  @IsUUID()
  onBehalfOfUserId?: string;
}
