import { IsInt, IsNumber, IsUUID, Max, Min } from 'class-validator';

export class UpsertCostCentreBudgetDto {
  @IsUUID()
  costCentreId!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear!: number;

  @IsNumber()
  budgeted!: number;
}
