import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminsService } from './admins.service';
import {
  CreateAdministratorDto,
  SwitchToManualBillingDto,
  UpdateAdministratorDto,
  UpdateOwnAdministratorDto,
  UpsertAdminBillingDto,
} from './dto/admins.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SkipSubscriptionGate } from '../auth/decorators/skip-subscription-gate.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

// Panel de plataforma — exclusivo del rol A salvo lo indicado.
@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get()
  @Roles('A')
  list() {
    return this.adminsService.list();
  }

  // 'me' antes de ':id': si no, Nest lo matchea como GET /admins/:id con id='me'.
  @Get('me')
  @Roles('B')
  findOwn(@CurrentUser() user: AuthenticatedUser) {
    return this.adminsService.findOwn(user);
  }

  @Patch('me')
  @Roles('B')
  updateOwn(@Body() dto: UpdateOwnAdministratorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.adminsService.updateOwn(dto, user);
  }

  @Get(':id')
  @Roles('A')
  findById(@Param('id') id: string) {
    return this.adminsService.findById(id);
  }

  @Post()
  @Roles('A')
  create(
    @Body() dto: CreateAdministratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminsService.create(dto, user);
  }

  @Patch(':id')
  @Roles('A')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAdministratorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminsService.update(id, dto, user);
  }

  /** «Pasar a facturación manual»: detaches a dead Stripe subscription (odd/tasks/role-a-panel.md T14). */
  @Post(':id/manual-billing')
  @Roles('A')
  switchToManualBilling(
    @Param('id') id: string,
    @Body() dto: SwitchToManualBillingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminsService.switchToManualBilling(id, dto, user);
  }

  @Put(':id/billing')
  @Roles('A')
  upsertBilling(@Param('id') id: string, @Body() dto: UpsertAdminBillingDto) {
    return this.adminsService.upsertBilling(id, dto);
  }

  @Post(':id/invoices')
  @Roles('A')
  issueInvoice(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminsService.issueInvoice(id, user);
  }

  /** Factura en PDF, con el QR de cotejo y la leyenda VERI*FACTU. */
  @Get('invoices/:invoiceId/pdf')
  @SkipSubscriptionGate()
  async invoicePdf(
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { fileName, content } = await this.adminsService.invoicePdf(
      invoiceId,
      user,
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.send(content);
  }

  /** Deja sin efecto una factura emitiendo su registro de anulación. */
  @Post('invoices/:invoiceId/void')
  @Roles('A')
  voidInvoice(
    @Param('invoiceId') invoiceId: string,
    @Body('reason') reason: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminsService.voidInvoice(invoiceId, reason, user);
  }

  // Rol B puede ver las facturas de SU gestora (comprobado en el servicio).
  // Exenta del gate de suscripción a propósito: es donde una gestora
  // vencida/bloqueada ve qué factura tiene pendiente.
  @Get(':id/invoices')
  @Roles('A', 'B')
  @SkipSubscriptionGate()
  listInvoices(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminsService.listInvoices(id, user);
  }
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly adminsService: AdminsService) {}

  // Exenta del gate de suscripción: es la propia pantalla que le explica a
  // una gestora vencida/bloqueada qué le pasa a su cuenta. Bloquearla
  // dejaría a esos usuarios sin ninguna forma de ver por qué ni cómo
  // resolverlo.
  @Get('me')
  @Roles('B')
  @SkipSubscriptionGate()
  mySubscription(@CurrentUser() user: AuthenticatedUser) {
    return this.adminsService.mySubscription(user);
  }
}

@Controller('plans')
export class PlansController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get()
  @Roles('A', 'B')
  @SkipSubscriptionGate()
  catalog() {
    return this.adminsService.getPlansCatalog();
  }
}
