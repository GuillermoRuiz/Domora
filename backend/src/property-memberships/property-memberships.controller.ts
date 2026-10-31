import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PropertyMembershipsService } from './property-memberships.service';
import { MembershipSettingsService } from './membership-settings.service';
import { PropertyMembershipInvitesService } from './property-membership-invites.service';
import { UpdateMembershipSettingsDto } from './dto/update-membership-settings.dto';
import { CreateMembershipInviteDto } from './dto/create-membership-invite.dto';
import { RevokeMembershipDto } from './dto/revoke-membership.dto';
import { CreateOwnerInviteDto } from './dto/create-owner-invite.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('properties/:propertyId/memberships')
export class PropertyMembershipsController {
  constructor(
    private readonly membershipsService: PropertyMembershipsService,
    private readonly settingsService: MembershipSettingsService,
    private readonly invitesService: PropertyMembershipInvitesService,
  ) {}

  @Get()
  listByProperty(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.membershipsService.listByProperty(propertyId, user);
  }

  @Get('primary-contact')
  findPrimaryContact(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.membershipsService.findPrimaryContact(propertyId, user);
  }

  // Privacidad y notificaciones — siempre "mis" ajustes; resuelto por
  // user.id, nunca por membershipId en la ruta.
  @Get('me/settings')
  getMySettings(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settingsService.getMine(propertyId, user);
  }

  @Patch('me/settings')
  updateMySettings(
    @Param('propertyId') propertyId: string,
    @Body() dto: UpdateMembershipSettingsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settingsService.updateMine(propertyId, user, dto);
  }

  // Sin @Roles: autorizado a mano en el servicio (primary contact de ESTA
  // propiedad, o rol A/B con acceso a su finca) — un rol C no puede invitar
  // a miembros de la propiedad de un vecino.
  @Post('invites')
  createInvite(
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateMembershipInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.createInvite(
      propertyId,
      dto.roleType,
      dto.inviteeEmail,
      user,
    );
  }

  // Solo gestora/Domora: el servicio además lo comprueba, pero así ni
  // siquiera llega un rol C (el titular principal sí puede invitar
  // inquilinos por la ruta de arriba, nunca propietarios).
  @Post('owner-invites')
  @Roles('A', 'B')
  createOwnerInvite(
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateOwnerInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.createOwnerInvite(
      propertyId,
      dto.externalOwnerId,
      user,
    );
  }

  @Get('invites')
  listPendingInvites(
    @Param('propertyId') propertyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.listPendingInvites(propertyId, user);
  }

  @Post('invites/:inviteId/resend')
  resendInvite(
    @Param('propertyId') propertyId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.resendInvite(propertyId, inviteId, user);
  }

  @Patch('invites/:inviteId/revoke')
  revokeInvite(
    @Param('propertyId') propertyId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.revokeInvite(propertyId, inviteId, user);
  }

  @Patch(':membershipId')
  revoke(
    @Param('propertyId') propertyId: string,
    @Param('membershipId') membershipId: string,
    @Body() dto: RevokeMembershipDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.membershipsService.revoke(
      propertyId,
      membershipId,
      user,
      dto.promoteMembershipId,
    );
  }
}

/** Sin `:propertyId` en la ruta — la propiedad se resuelve a partir del token, igual que `auth/team-invites/:token`. */
@Controller('membership-invites')
export class MembershipInvitesController {
  constructor(
    private readonly invitesService: PropertyMembershipInvitesService,
  ) {}

  @Public()
  @Get(':token')
  getInviteInfo(@Param('token') token: string) {
    return this.invitesService.getInviteInfo(token);
  }

  // Sin @Public: a diferencia de un team-invite (que crea una cuenta desde
  // cero), acá quien canjea el token puede ya tener cuenta propia — el
  // canje solo adjunta la membresía al usuario ya autenticado.
  @Post(':token/redeem')
  redeemInvite(
    @Param('token') token: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.redeemInvite(token, user);
  }
}

@Controller('users/:userId/memberships')
export class UserMembershipsController {
  constructor(
    private readonly membershipsService: PropertyMembershipsService,
  ) {}

  @Get()
  listByUser(
    @Param('userId') userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.membershipsService.listByUser(userId, user);
  }
}
