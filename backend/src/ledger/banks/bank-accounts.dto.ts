import {
  IsBoolean,
  IsIBAN,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/** El IBAN se guarda sin espacios y en mayúsculas; se valida el dígito de control. */
const normalizeIban = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value;

export class CreateBankAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  alias!: string;

  @IsOptional()
  @Transform(normalizeIban)
  @IsIBAN(
    {},
    { message: 'El IBAN no es válido (revisa los dígitos de control).' },
  )
  iban?: string;

  @IsOptional()
  @IsString()
  @Length(8, 11)
  bic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  /** Cuenta separada donde la comunidad guarda el fondo de reserva. */
  @IsOptional()
  @IsBoolean()
  isReserveAccount?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsISO8601({ strict: true })
  openedOn?: string;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  alias?: string;

  @IsOptional()
  @Transform(normalizeIban)
  @IsIBAN(
    {},
    { message: 'El IBAN no es válido (revisa los dígitos de control).' },
  )
  iban?: string;

  @IsOptional()
  @IsString()
  @Length(8, 11)
  bic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @IsOptional()
  @IsBoolean()
  isReserveAccount?: boolean;

  /** Solo admite true: la cuenta por defecto se cambia eligiendo otra. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  /** true la cierra (exige saldo cero), false la reabre. */
  @IsOptional()
  @IsBoolean()
  closed?: boolean;
}
