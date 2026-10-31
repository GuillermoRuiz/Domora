import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';
import { ChangePlanDto } from './dto/billing.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

// Facturación de la suscripción SaaS (Domora → gestoras). Todo @Roles('B')
// salvo el webhook, que Stripe llama sin ningún JWT nuestro — se autentica
// con su propia firma HMAC (BillingService.handleWebhookEvent).
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  @Roles('B')
  checkout(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.createCheckoutSession(user);
  }

  @Post('setup-payment-method')
  @Roles('B')
  setupPaymentMethod(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.createSetupPaymentMethodSession(user);
  }

  // El customerId se resuelve en el servicio a partir del JWT — nunca se
  // acepta uno en el body (ver comentario en BillingService.openPortal).
  @Post('portal')
  @Roles('B')
  portal(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.openPortal(user);
  }

  @Post('change-plan')
  @Roles('B')
  changePlan(
    @Body() dto: ChangePlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.billing.changePlan(user, dto);
  }

  @Post('cancel')
  @Roles('B')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthenticatedUser) {
    return this.billing.cancelSubscription(user);
  }

  /**
   * Stripe llama aquí directamente, sin pasar por el frontend — de ahí
   * `@Public()`. La autenticidad del evento se verifica con la firma HMAC
   * (`stripe-signature` + `STRIPE_WEBHOOK_SECRET`), no con un JWT.
   * Necesita el cuerpo SIN parsear (`req.rawBody`, habilitado en
   * `main.ts` con `rawBody: true`) porque la firma se calcula sobre los
   * bytes exactos que Stripe envió — un JSON reserializado no coincidiría.
   */
  @Post('webhook')
  @Public()
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['stripe-signature'];
    if (!signature || Array.isArray(signature)) {
      throw new BadRequestException('Falta la cabecera stripe-signature.');
    }
    if (!req.rawBody) {
      throw new BadRequestException(
        'No se recibió el cuerpo crudo de la petición.',
      );
    }
    await this.billing.handleWebhookEvent(req.rawBody, signature);
    return { received: true };
  }
}
