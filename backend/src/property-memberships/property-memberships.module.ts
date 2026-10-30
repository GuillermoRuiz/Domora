import { Module } from '@nestjs/common';
import {
  PropertyMembershipsController,
  UserMembershipsController,
  MembershipInvitesController,
} from './property-memberships.controller';
import { PropertyMembershipsService } from './property-memberships.service';
import { MembershipSettingsService } from './membership-settings.service';
import { PropertyMembershipInvitesService } from './property-membership-invites.service';
import { PropertyMembershipInvitesCronService } from './property-membership-invites-cron.service';
import { EstateAccessModule } from '../estate-access/estate-access.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [EstateAccessModule, MailModule],
  controllers: [
    PropertyMembershipsController,
    UserMembershipsController,
    MembershipInvitesController,
  ],
  providers: [
    PropertyMembershipsService,
    MembershipSettingsService,
    PropertyMembershipInvitesService,
    PropertyMembershipInvitesCronService,
  ],
  exports: [PropertyMembershipsService, MembershipSettingsService],
})
export class PropertyMembershipsModule {}
