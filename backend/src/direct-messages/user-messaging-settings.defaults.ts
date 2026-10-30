import type { DirectMessagePolicy, DisplayNamePolicy } from '../prisma/client';

/**
 * Defaults en memoria — devueltos cuando no existe fila en
 * `user_messaging_settings` (creación perezosa, nunca backfill). Deben
 * coincidir con los `@default(...)` del schema. Ver
 * `membership-settings.defaults.ts` — mismo criterio para usuarios rol A/B.
 */
export const USER_MESSAGING_SETTINGS_DEFAULTS = {
  allowDirectMessages: 'anyone_linked' as DirectMessagePolicy,
  displayNamePolicy: 'full_name' as DisplayNamePolicy,
  displayAlias: null as string | null,
};

export type UserMessagingSettingsValues =
  typeof USER_MESSAGING_SETTINGS_DEFAULTS;
