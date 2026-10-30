import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { TasksService } from './tasks.service';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Bandeja de notificaciones del usuario en sesión. Todo se acota a
 * `user.id` (nunca se recibe un userId del cliente).
 *
 * El orden de las rutas importa: las estáticas (`summary`, `read-all`,
 * `preferences`) van ANTES de `:id/read` para que no las capture el parámetro.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query() query: ListNotificationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.list(user, query);
  }

  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.summary(user);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user);
  }

  /** Solo gestora y soporte: los propietarios ajustan las suyas por vivienda. */
  @Get('preferences')
  @Roles('A', 'B')
  preferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.getPreferences(user);
  }

  @Put('preferences')
  @Roles('A', 'B')
  updatePreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.updatePreferences(user, dto);
  }

  @Post(':id/read')
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notifications.markRead(user, id);
  }
}

@Controller('tasks')
@Roles('A', 'B')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.tasks.list(user);
  }
}
