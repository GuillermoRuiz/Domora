import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  DirectMessagePolicy,
  DisplayNamePolicy,
  NotificationSetting,
} from '../../prisma/client';

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
const NOTIFICATION_SETTINGS: NotificationSetting[] = [
  'none',
  'push_only',
  'email_only',
  'email_push',
];

/** Todos los campos opcionales — PATCH parcial sobre la fila (lazy-created). */
export class UpdateMembershipSettingsDto {
  @IsOptional()
  @IsBoolean()
  visibleInDirectory?: boolean;

  @IsOptional()
  @IsBoolean()
  showPhoneInDirectory?: boolean;

  @IsOptional()
  @IsBoolean()
  showEmailInDirectory?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleInBookings?: boolean;

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

  @IsOptional()
  @IsIn(NOTIFICATION_SETTINGS)
  notifyIssues?: NotificationSetting;

  @IsOptional()
  @IsIn(NOTIFICATION_SETTINGS)
  notifyReceipts?: NotificationSetting;

  @IsOptional()
  @IsIn(NOTIFICATION_SETTINGS)
  notifyCommunications?: NotificationSetting;

  @IsOptional()
  @IsIn(NOTIFICATION_SETTINGS)
  notifyBookings?: NotificationSetting;

  @IsOptional()
  @IsIn(NOTIFICATION_SETTINGS)
  notifyDirectMessages?: NotificationSetting;
}
