import {
  IsInt,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class UpsertBudgetItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  accountCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(150)
  category!: string;

  @IsInt()
  @Min(2000)
  @Max(2100)
  fiscalYear!: number;

  @IsNumber()
  budgeted!: number;
}
