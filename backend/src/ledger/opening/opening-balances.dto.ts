import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type { AccountRole } from '../../prisma/client';
import {
  DIFFERENCE_ROLES,
  OTHER_BALANCE_ROLES,
} from './opening-balances.rules';

const EUROS = { maxDecimalPlaces: 2 } as const;
const AMOUNT = {
  message: 'El importe debe ser mayor que cero, con dos decimales como mucho.',
};

export class OpeningBankBalanceDto {
  @IsUUID()
  bankAccountId!: string;

  @IsNumber(EUROS, AMOUNT)
  @Min(0.01)
  @Max(100_000_000)
  balance!: number;
}

export class OpeningPropertyDebtDto {
  @IsUUID()
  propertyId!: string;

  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(2000)
  @Max(2100)
  originYear!: number;

  @IsString()
  @MinLength(3, {
    message:
      'Indica el concepto de la deuda (p. ej. "Cuotas 2024 pendientes").',
  })
  @MaxLength(255)
  concept!: string;

  @IsNumber(EUROS, AMOUNT)
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;
}

export class OpeningPropertyAdvanceDto {
  @IsUUID()
  propertyId!: string;

  @IsString()
  @MinLength(3, { message: 'Indica el concepto del anticipo.' })
  @MaxLength(255)
  concept!: string;

  @IsNumber(EUROS, AMOUNT)
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;
}

export class OpeningSupplierInvoiceDto {
  @IsUUID()
  supplierId!: string;

  @IsString()
  @MinLength(1, { message: 'Indica el número de la factura.' })
  @MaxLength(60)
  number!: string;

  @IsString()
  @MinLength(3, { message: 'Indica el concepto de la factura.' })
  @MaxLength(300)
  concept!: string;

  @IsISO8601(
    { strict: true },
    { message: 'La fecha de la factura no es válida.' },
  )
  issueDate!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;

  /** Lo que queda por pagar, no el total original si ya se pagó algo antes de migrar. */
  @IsNumber(EUROS, AMOUNT)
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;

  /** 400 (proveedores) o 410 (acreedores) — ADR, D9. Por defecto 400. */
  @IsOptional()
  @IsIn(['suppliers_payable', 'creditors_payable'])
  payableRole?: 'suppliers_payable' | 'creditors_payable';
}

export class OpeningOtherBalanceDto {
  @IsIn(OTHER_BALANCE_ROLES)
  role!: AccountRole;

  @IsString()
  @MinLength(3, { message: 'Indica el concepto de este saldo.' })
  @MaxLength(255)
  concept!: string;

  @IsIn(['debit', 'credit'])
  side!: 'debit' | 'credit';

  @IsNumber(EUROS, AMOUNT)
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;
}

/** Cuerpo de `PUT /opening-balances`: reemplaza TODAS las filas del borrador de una vez. */
export class SaveOpeningDraftDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OpeningBankBalanceDto)
  bankBalances!: OpeningBankBalanceDto[];

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => OpeningPropertyDebtDto)
  propertyDebts!: OpeningPropertyDebtDto[];

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => OpeningPropertyAdvanceDto)
  propertyAdvances!: OpeningPropertyAdvanceDto[];

  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => OpeningSupplierInvoiceDto)
  supplierInvoices!: OpeningSupplierInvoiceDto[];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OpeningOtherBalanceDto)
  otherBalances!: OpeningOtherBalanceDto[];
}

/** Cuerpo de `POST /opening-balances/post` y `.../repost`. */
export class PostOpeningDto {
  /** Solo si `validate()` dio una diferencia distinta de cero. */
  @IsOptional()
  @IsIn(DIFFERENCE_ROLES)
  differenceRole?: 'reserve_fund' | 'retained';
}

/** Cuerpo de `POST /opening-balances/no-prior-balances`. */
export class ConfirmNoPriorBalancesDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
