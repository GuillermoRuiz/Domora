import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as exempt from JwtAuthGuard. Used on /auth/login and
 * /auth/refresh, which by definition cannot require a valid access token.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
