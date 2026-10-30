import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AgendaItemDto } from './create-meeting.dto';

/**
 * Edición de una junta ya convocada. Solo los datos de la convocatoria: la
 * lista de invitados y la videollamada (sala, contraseña, invitaciones ya
 * enviadas) se fijan al crear y no se tocan desde aquí. Todos los campos son
 * opcionales — solo se actualiza lo que viene.
 */
export class UpdateMeetingDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(36)
  title?: string;

  @IsOptional()
  @IsIn(['ordinaria', 'extraordinaria'])
  type?: 'ordinaria' | 'extraordinaria';

  @IsOptional()
  @IsDateString()
  scheduledAt1?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt2?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AgendaItemDto)
  agenda?: AgendaItemDto[];

  @IsOptional()
  @IsIn(['presidente', 'cuotas25', 'propietarios25', 'mandatoJudicial'])
  convokedBy?: 'presidente' | 'cuotas25' | 'propietarios25' | 'mandatoJudicial';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @IsString()
  locationPlaceId?: string;

  @IsOptional()
  @IsNumber()
  locationLat?: number;

  @IsOptional()
  @IsNumber()
  locationLng?: number;

  @IsOptional()
  @IsIn(['administrador', 'presidente', 'secretario'])
  signerRole?: 'administrador' | 'presidente' | 'secretario';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  signerName?: string;
}
