import { IsArray, IsBoolean, IsInt, IsOptional, IsUUID } from 'class-validator';

/** La gestora registra el voto de una propiedad presente o representada (sin 2FA: no vota ella). */
export class RegisterVoteDto {
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

  /**
   * La gestora confirma que registra el voto pese a la deuda vencida de la propiedad (art. 15.2 LPH:
   * p. ej. deuda impugnada judicialmente o consignada). Sin esto, una propiedad con deuda no puede votar.
   */
  @IsOptional()
  @IsBoolean()
  overrideDebt?: boolean;
}
