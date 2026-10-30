import { Equals, IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RedeemAdminInviteDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  /** Checkbox obligatorio de Términos y Condiciones + Política de Privacidad — ver AuthService.redeemAdminInvite. */
  @Equals(true)
  termsAccepted!: boolean;
}
