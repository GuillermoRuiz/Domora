import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export class CreatePaymentAgreementDto {
  /** Deuda total al firmar (principal + intereses del deudor). */
  @IsNumber()
  @Min(0.01)
  totalAmount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  downPaymentAmount?: number;

  @IsInt()
  @Min(1)
  installmentsCount!: number;

  @IsDateString()
  firstDueDate!: string;
}
