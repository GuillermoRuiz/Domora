import { IsOptional, IsUUID } from 'class-validator';

/** `promoteMembershipId` solo hace falta cuando se revoca al único primary contact activo de la propiedad — ver `PropertyMembershipsService.revoke`. */
export class RevokeMembershipDto {
  @IsOptional()
  @IsUUID()
  promoteMembershipId?: string;
}
