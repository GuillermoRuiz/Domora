import { IsString, Length, MinLength } from 'class-validator';

export class VerifyEnableTwoFactorDto {
  /** El secreto que devolvió /enroll — no se persiste hasta que este código lo confirma. */
  @IsString()
  @MinLength(16)
  secret!: string;

  @IsString()
  @Length(6, 6)
  code!: string;
}
