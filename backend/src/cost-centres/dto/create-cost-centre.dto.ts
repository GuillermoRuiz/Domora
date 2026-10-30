import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCostCentreDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;
}
