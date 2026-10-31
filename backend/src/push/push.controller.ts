import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { PushService } from './push.service';
import {
  CreatePushSubscriptionDto,
  DeletePushSubscriptionDto,
} from './dto/push-subscription.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  /**
   * Pública para cualquier usuario autenticado — el frontend la pide justo
   * antes de suscribirse, así la clave no queda hardcodeada en el bundle.
   * No es secreta por diseño (es la mitad "pública" del par VAPID).
   */
  @Get('vapid-public-key')
  vapidPublicKey(): { publicKey: string | null } {
    return { publicKey: this.push.getPublicKey() };
  }

  @Post('subscriptions')
  @HttpCode(204)
  async subscribe(
    @Body() dto: CreatePushSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.push.saveSubscription(user.id, dto);
  }

  @Delete('subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @Body() dto: DeletePushSubscriptionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.push.removeSubscription(user.id, dto.endpoint);
  }
}
