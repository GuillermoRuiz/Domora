import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RevokeVoteDelegationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
