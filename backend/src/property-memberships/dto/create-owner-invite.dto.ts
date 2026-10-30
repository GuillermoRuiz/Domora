import { IsUUID } from 'class-validator';

/**
 * Invitación de Propietario: el email y la propiedad salen del titular
 * importado, nunca del cuerpo — así nadie puede invitar como Propietario
 * a una dirección que la gestora no registró.
 */
export class CreateOwnerInviteDto {
  @IsUUID()
  externalOwnerId!: string;
}
