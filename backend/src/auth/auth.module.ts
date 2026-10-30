import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { StringValue } from 'ms';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoginThrottleGuard } from './guards/login-throttle.guard';
import { TokenCleanupService } from './token-cleanup.service';
import { MailModule } from '../mail/mail.module';
import { SupportAccessModule } from '../support-access/support-access.module';

@Module({
  imports: [
    MailModule,
    SupportAccessModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // Sin fallback: validateEnv (ver config/env.validation.ts) garantiza
        // que existe — en producción exigiéndola, en desarrollo inyectando
        // el valor por defecto. Un `?? 'dev-secret-...'` aquí volvería a
        // permitir que un despliegue sin el secreto arrancase en silencio.
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          // JWT_ACCESS_EXPIRES is a free-form env var (e.g. "15m"); `ms`'s
          // StringValue type can't be verified at compile time for a
          // runtime-read string, so this is an intentional, narrow cast.
          expiresIn:
            (configService.get<string>('JWT_ACCESS_EXPIRES') as StringValue) ??
            '15m',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  // JwtAuthGuard/RolesGuard are also exported so future modules can re-use
  // them explicitly (e.g. in unit tests) even though the global
  // registration in AppModule (APP_GUARD) already applies them to every
  // route by default — see doc/plan.md section 2.3.
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    LoginThrottleGuard,
    TokenCleanupService,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
