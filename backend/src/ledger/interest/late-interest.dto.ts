import {
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Cuerpo de `POST .../late-interest/preview` y `.../accrue`. */
export class LateInterestRequestDto {
  @IsUUID()
  receiptId!: string;

  /** Hasta qué día liquidar (sin incluirlo). Por defecto, hoy. */
  @IsOptional()
  @IsISO8601({ strict: true })
  asOfDate?: string;
}

/** Cuerpo de `POST estates/:estateId/late-interest-policies`. */
export class CreateLatePaymentInterestPolicyDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  annualRatePct!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  graceDays?: number;

  @IsISO8601({ strict: true })
  validFrom!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  meetingReference?: string;
}

/** Cuerpo de `PATCH .../late-interest-policies/:id` — solo cierra la vigencia (nunca se edita el tipo ya usado). */
export class CloseLatePaymentInterestPolicyDto {
  @IsISO8601({ strict: true })
  validTo!: string;
}
