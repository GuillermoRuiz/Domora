import { IsEmail, IsIn } from 'class-validator';
import { MembershipRoleType } from '../../prisma/client';

/** Nunca `Propietario`/`Otro` por invitación — un cambio de titularidad es otra operación (fuera de alcance). */
const INVITABLE_ROLE_TYPES: MembershipRoleType[] = ['Inquilino', 'Representante', 'Ocupante'];

export class CreateMembershipInviteDto {
  @IsIn(INVITABLE_ROLE_TYPES)
  roleType!: MembershipRoleType;

  /** Solo el destino del envío — nunca se usa para resolver una cuenta ya existente (el invitado a menudo no tiene cuenta todavía). */
  @IsEmail()
  inviteeEmail!: string;
}
