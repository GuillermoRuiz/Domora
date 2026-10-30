import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SkipSubscriptionGate } from '../auth/decorators/skip-subscription-gate.decorator';
import { UpdateOwnBillingDto } from './admin-billing.dto';
import { AdminBillingService, type OwnBilling, type SepaMandateView } from './admin-billing.service';

/** Billing data of the despachos and their SEPA mandates (odd/tasks/role-a-panel.md S17). */
@Controller('admin-billing')
export class AdminBillingController {
  constructor(private readonly billing: AdminBillingService) {}

  /**
   * Role B: its own despacho, always taken from the token. Exempt from the
   * subscription gate: a despacho whose payment failed must still be able to
   * fix its billing data and payment method.
   */
  @Get('me')
  @Roles('B')
  @SkipSubscriptionGate()
  getOwn(@CurrentUser() user: AuthenticatedUser): Promise<OwnBilling> {
    return this.billing.getOwn(user);
  }

  @Put('me')
  @Roles('B')
  @SkipSubscriptionGate()
  updateOwn(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOwnBillingDto): Promise<OwnBilling> {
    return this.billing.updateOwn(user, dto);
  }

  /** Role A: the SEPA mandates of one despacho, for its ficha. */
  @Get(':administratorId/sepa-mandates')
  @Roles('A')
  mandates(@Param('administratorId', ParseUUIDPipe) administratorId: string): Promise<SepaMandateView[]> {
    return this.billing.mandatesOf(administratorId);
  }
}
