import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateChartAccountDto {
  /** Solo dígitos (3 a 10). Si cuelga de otra cuenta, debe empezar por su código. */
  @Matches(/^[0-9]{3,10}$/, {
    message: 'El código de cuenta son de 3 a 10 dígitos.',
  })
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  shortName?: string;

  /** Cuenta padre. Sin ella, la cuenta queda en el primer nivel. */
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateChartAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  shortName?: string | null;

  /** true archiva (deja de admitir apuntes), false la reactiva. */
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}
