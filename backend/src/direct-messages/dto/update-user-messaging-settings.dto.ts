import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { DirectMessagePolicy, DisplayNamePolicy } from '../../prisma/client';

const DIRECT_MESSAGE_POLICIES: DirectMessagePolicy[] = [
  'nobody',
  'neighbors',
  'anyone_linked',
];
const DISPLAY_NAME_POLICIES: DisplayNamePolicy[] = [
  'full_name',
  'alias',
  'address',
];

/** Equivalente de UpdateMembershipSettingsDto para usuarios sin PropertyMembership (rol A/B). */
export class UpdateUserMessagingSettingsDto {
  @IsOptional()
  @IsIn(DIRECT_MESSAGE_POLICIES)
  allowDirectMessages?: DirectMessagePolicy;

  @IsOptional()
  @IsIn(DISPLAY_NAME_POLICIES)
  displayNamePolicy?: DisplayNamePolicy;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayAlias?: string;
}
