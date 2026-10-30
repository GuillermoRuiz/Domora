import { IsOptional, IsString } from 'class-validator';

export class RejectAdhesionDto {
  @IsOptional()
  @IsString()
  notes?: string;
}
