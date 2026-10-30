import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateIssueBudgetDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @IsOptional()
  @IsString()
  budgetDescription?: string;

  @IsOptional()
  @IsBoolean()
  budgetApproved?: boolean;
}
