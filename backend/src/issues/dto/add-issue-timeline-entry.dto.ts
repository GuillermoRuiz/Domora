import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class AddIssueTimelineEntryDto {
  @IsString()
  @MinLength(1)
  text!: string;

  /** Manager-only note that owners never see (ignored when an owner writes). */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}
