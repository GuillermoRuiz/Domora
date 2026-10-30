import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
} from 'class-validator';
import { NotificationCategory } from '../../prisma/client';

const CATEGORIES = Object.values(NotificationCategory);

export class NotificationPreferenceDto {
  @IsIn(CATEGORIES)
  category!: NotificationCategory;

  @IsBoolean()
  emailEnabled!: boolean;
}

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(CATEGORIES.length)
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceDto)
  preferences!: NotificationPreferenceDto[];
}
