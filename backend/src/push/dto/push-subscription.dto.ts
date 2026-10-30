import { IsNotEmpty, IsOptional, IsString, IsUrl, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}

export class CreatePushSubscriptionDto {
  @IsUrl({ require_tld: false })
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class DeletePushSubscriptionDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  endpoint?: string;
}
