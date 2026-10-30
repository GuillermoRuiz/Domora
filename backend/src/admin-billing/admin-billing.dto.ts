import { AdminPayMethod } from '../prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIBAN,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** The IBAN is stored without spaces and upper-cased; its check digits are validated. */
const normalizeIban = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, '').toUpperCase() : value;

/** The despacho's acceptance of the SEPA direct debit order shown to it. */
export class SepaMandateAcceptanceDto {
  @Equals(true, { message: 'Para domiciliar los cobros tienes que aceptar la orden de domiciliación SEPA.' })
  accepted!: boolean;

  /** The reference printed on the order the user read (`GET /admin-billing/me`). */
  @IsString()
  @MaxLength(35)
  reference!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Indica el titular de la cuenta.' })
  @MaxLength(200)
  debtorName!: string;
}

/**
 * Billing data the despacho (role B) edits itself. There is no administratorId
 * on purpose: the despacho always comes from the token.
 */
export class UpdateOwnBillingDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Indica la razón social.' })
  @MaxLength(200)
  businessName!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Indica el NIF/CIF.' })
  @MaxLength(20)
  cif!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Indica el domicilio fiscal.' })
  @MaxLength(255)
  address!: string;

  @Transform(trim)
  @IsEmail({}, { message: 'El email de facturación no es válido.' })
  @MaxLength(200)
  email!: string;

  @IsIn(Object.values(AdminPayMethod), { message: 'Elige un método de pago válido.' })
  paymentMethod!: AdminPayMethod;

  @IsOptional()
  @Transform(normalizeIban)
  @IsIBAN({}, { message: 'El IBAN no es válido (revisa los dígitos de control).' })
  iban?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SepaMandateAcceptanceDto)
  mandate?: SepaMandateAcceptanceDto;
}
