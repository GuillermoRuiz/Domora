import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { PushModule } from '../push/push.module';
import {
  NotificationsController,
  TasksController,
} from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsCleanupService } from './notifications-cleanup.service';
import { TasksService } from './tasks.service';

/**
 * Sin dependencias de los módulos de dominio a propósito: son ellos los que
 * importan este (para emitir avisos), y una dependencia en sentido contrario
 * sería circular. Por eso `TasksService` y el recuento de mensajes leen las
 * tablas directamente, igual que `ResourcesService` con sus alertas.
 */
@Module({
  imports: [MailModule, PushModule],
  controllers: [NotificationsController, TasksController],
  providers: [NotificationsService, NotificationsCleanupService, TasksService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
