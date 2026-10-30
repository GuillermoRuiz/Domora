import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser, JwtPayload } from '../auth.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
    });
  }

  /**
   * Whatever this returns becomes `request.user`. We intentionally keep it
   * to the claims already present in the JWT (no extra DB round-trip on
   * every request) — endpoints that need fresh user data (e.g. GET /auth/me)
   * query Prisma explicitly instead.
   */
  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      id: payload.sub,
      role: payload.role,
      estateIds: payload.estateIds,
      administratorId: payload.administratorId,
    };
  }
}
