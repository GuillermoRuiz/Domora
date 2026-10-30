import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * El activo (`assetId`) siempre se elige entre los ya existentes de la
 * finca — si el usuario quiere un elemento nuevo, el frontend lo crea antes
 * con `POST estates/:estateId/assets` y pasa el id resultante aquí. Sin
 * creación implícita anidada, igual que el resto de la API.
 */
export class CreateInspectionDto {
  @IsUUID()
  assetId!: string;

  @IsUUID()
  inspectionTypeId!: string;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  reminderDaysBefore?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
