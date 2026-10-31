import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  AdminPayMethod,
  AdminStatus,
  BillingInterval,
  PlanTier,
} from '../../prisma/client';

const PLANS: PlanTier[] = ['BASE', 'STANDARD', 'PREMIUM'];
const STATUSES: AdminStatus[] = [
  'Activa',
  'Periodo_de_gracia',
  'Vencida',
  'Bloqueada',
];
const PAY_METHODS: AdminPayMethod[] = [
  'Domiciliacion',
  'Tarjeta',
  'Transferencia',
];

export class CreateAdministratorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  cif!: string;

  @IsIn(PLANS)
  plan!: PlanTier;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class UpdateAdministratorDto {
  @IsOptional()
  @IsIn(PLANS)
  plan?: PlanTier;

  @IsOptional()
  @IsIn(STATUSES)
  status?: AdminStatus;

  /** Ampliación de tramo de usuarios — debe existir en el catálogo del plan. */
  @IsOptional()
  @IsInt()
  @Min(1)
  usersMax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discountPct?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  discountReason?: string;

  @IsOptional()
  @IsDateString()
  discountUntil?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  /** Only for manually billed clients: with Stripe, the webhook sets it from the price. */
  @IsOptional()
  @IsIn(Object.values(BillingInterval))
  billingInterval?: BillingInterval;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  blockReason?: string;
}

/**
 * «Pasar a facturación manual» (role A). Both fields are optional and applied
 * in the same transaction as the detach: a Stripe cancellation leaves the
 * despacho Vencida (the webhook restricts it), so without `activate` it would
 * stay Suspendido and outside the MRR until a second, separate action.
 */
export class SwitchToManualBillingDto {
  /** Vencida → Activa. Bloqueada is refused: unblocking is its own decision. */
  @IsOptional()
  @IsBoolean()
  activate?: boolean;

  @IsOptional()
  @IsIn(Object.values(BillingInterval))
  billingInterval?: BillingInterval;
}

export class UpsertAdminBillingDto {
  @IsString()
  @MinLength(1)
  businessName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  cif!: string;

  @IsString()
  @MinLength(1)
  address!: string;

  @IsEmail()
  email!: string;

  @IsIn(PAY_METHODS)
  paymentMethod!: AdminPayMethod;

  @IsOptional()
  @IsString()
  @MaxLength(34)
  iban?: string;
}

/**
 * Lo que una gestora (rol B) puede cambiar de su propia empresa. La razón
 * social y el CIF quedan fuera a propósito: cambiarlos es cambiar de
 * entidad legal (afecta a la facturación de Domora), así que lo hace
 * Domora (rol A) desde su panel. `null` borra el valor.
 */
export class UpdateOwnAdministratorDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  contactEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vatNumber?: string | null;
}
