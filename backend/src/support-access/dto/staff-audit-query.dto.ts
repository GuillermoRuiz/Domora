import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class StaffAuditQueryDto {
  @IsOptional() @IsUUID() administratorId?: string;
  @IsOptional() @IsUUID() staffUserId?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 50;
}
