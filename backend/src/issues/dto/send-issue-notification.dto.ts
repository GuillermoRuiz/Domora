import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { NotificationChannel } from '../../prisma/client';

const CHANNELS: NotificationChannel[] = ['email', 'push', 'sms', 'mixed'];

export class SendIssueNotificationDto {
  @IsInt()
  @Min(0)
  recipientsCount!: number;

  @IsIn(CHANNELS)
  channel!: NotificationChannel;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
