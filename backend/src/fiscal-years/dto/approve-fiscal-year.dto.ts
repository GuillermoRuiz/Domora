import { IsOptional, IsString } from 'class-validator';

export class ApproveFiscalYearDto {
  @IsOptional()
  @IsString()
  approvedNote?: string;
}
