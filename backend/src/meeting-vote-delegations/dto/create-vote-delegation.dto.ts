import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * El representante se indica de UNA de estas formas (el servicio lo exige):
 *  - `representativeEmail`: usuario con cuenta en Domora. Es la vía del vecino
 *    (rol C) y la del desplegable de propietarios de la gestora — art. 15.1 LPH
 *    no exige que sea propietario ni residente, y exponer el listado completo
 *    de miembros a un vecino sería una fuga de privacidad (por eso no hay
 *    `representativeUserId`).
 *  - `representativeName` + `representativeDni`: persona externa sin cuenta.
 */
export class CreateVoteDelegationDto {
  @IsUUID()
  propertyId!: string;

  @IsUUID()
  delegatorUserId!: string;

  @ValidateIf(
    (o: CreateVoteDelegationDto) => o.representativeEmail !== undefined,
  )
  @IsEmail()
  representativeEmail?: string;

  @ValidateIf(
    (o: CreateVoteDelegationDto) => o.representativeName !== undefined,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  representativeName?: string;

  @ValidateIf((o: CreateVoteDelegationDto) => o.representativeDni !== undefined)
  @IsString()
  @MaxLength(20)
  representativeDni?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
