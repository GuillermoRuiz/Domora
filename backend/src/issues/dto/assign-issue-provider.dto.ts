import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class AssignIssueProviderDto {
  /** Null/ausente = proveedor ad-hoc sin ficha en `suppliers` (Apéndice G). */
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  /** Obligatorio si no hay proveedor del directorio; con uno, el nombre sale de su ficha. */
  @ValidateIf((o: AssignIssueProviderDto) => !o.supplierId)
  @IsString()
  @MinLength(1)
  providerNameSnapshot?: string;

  @IsOptional()
  @IsString()
  categorySnapshot?: string;

  @IsOptional()
  @IsString()
  phoneSnapshot?: string;

  /** Una fecha (`AAAA-MM-DD`): lo que envía el control de fecha de la pantalla. */
  @IsOptional()
  @IsDateString(
    {},
    { message: 'La fecha estimada de resolución no es una fecha válida.' },
  )
  estimatedResolutionDate?: string;
}
