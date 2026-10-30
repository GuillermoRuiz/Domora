import type {
  DirectMessagePolicy,
  DisplayNamePolicy,
  NotificationSetting,
} from '../prisma/client';

/**
 * Defaults en memoria — devueltos cuando no existe fila en
 * `property_membership_settings` (creación perezosa, nunca backfill).
 * Deben coincidir exactamente con los `@default(...)` del schema.
 */
export const MEMBERSHIP_SETTINGS_DEFAULTS = {
  visibleInDirectory: true,
  showPhoneInDirectory: false,
  showEmailInDirectory: false,
  visibleInBookings: true,
  allowDirectMessages: 'neighbors' as DirectMessagePolicy,
  displayNamePolicy: 'full_name' as DisplayNamePolicy,
  displayAlias: null as string | null,
  notifyIssues: 'email_push' as NotificationSetting,
  notifyReceipts: 'email_push' as NotificationSetting,
  notifyCommunications: 'email_push' as NotificationSetting,
  notifyBookings: 'push_only' as NotificationSetting,
  notifyDirectMessages: 'email_push' as NotificationSetting,
};

export type MembershipSettingsValues = typeof MEMBERSHIP_SETTINGS_DEFAULTS;
