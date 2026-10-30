import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { CreateAdminInviteDto } from './dto/create-admin-invite.dto';
import { RedeemAdminInviteDto } from './dto/redeem-admin-invite.dto';
import { RedeemTeamInviteDto } from './dto/redeem-team-invite.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { SkipSubscriptionGate } from './decorators/skip-subscription-gate.decorator';
import { LoginThrottleGuard } from './guards/login-throttle.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthenticatedUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @UseGuards(LoginThrottleGuard)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Public()
  @Post('register')
  @UseGuards(LoginThrottleGuard)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('admin-invites')
  @Roles('A')
  createAdminInvite(@Body() dto: CreateAdminInviteDto) {
    return this.authService.createAdminInvite(dto.administratorId);
  }

  @Public()
  @Get('admin-invites/:token')
  getAdminInviteInfo(@Param('token') token: string) {
    return this.authService.getAdminInviteInfo(token);
  }

  @Public()
  @Post('admin-invites/:token/redeem')
  @UseGuards(LoginThrottleGuard)
  redeemAdminInvite(
    @Param('token') token: string,
    @Body() dto: RedeemAdminInviteDto,
  ) {
    return this.authService.redeemAdminInvite(token, dto);
  }

  /** Autoservicio: cualquier usuario rol B ya activo invita colegas a SU MISMA gestora. */
  @Post('team-invites')
  @Roles('B')
  createTeamInvite(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.createTeamInvite(user);
  }

  @Public()
  @Get('team-invites/:token')
  getTeamInviteInfo(@Param('token') token: string) {
    return this.authService.getTeamInviteInfo(token);
  }

  @Public()
  @Post('team-invites/:token/redeem')
  @UseGuards(LoginThrottleGuard)
  redeemTeamInvite(
    @Param('token') token: string,
    @Body() dto: RedeemTeamInviteDto,
  ) {
    return this.authService.redeemTeamInvite(token, dto);
  }

  @Public()
  @Post('forgot-password')
  @UseGuards(LoginThrottleGuard)
  requestPasswordReset(@Body() dto: ForgotPasswordDto) {
    return this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Get('forgot-password/:token')
  checkPasswordResetToken(@Param('token') token: string) {
    return this.authService.checkPasswordResetToken(token);
  }

  @Public()
  @Post('reset-password')
  @UseGuards(LoginThrottleGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // Público como login/refresh: no necesita el access token — el propio
  // refresh token del body ES la credencial (mismo modelo de confianza que
  // /auth/refresh). Antes exigía JWT válido, pero el frontend limpia su
  // access token ANTES de llamar a este endpoint (logout() en
  // auth.service.ts), así que la petición siempre salía sin Authorization
  // header y el guard global la rechazaba con 401 — el refresh token
  // JAMÁS se revocaba en el servidor pese a que el usuario veía "sesión
  // cerrada" (el catch{} del frontend se tragaba el error en silencio).
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.authService.logout(dto.refreshToken);
  }

  // Exenta del gate de suscripción: "quién soy" debe responder siempre,
  // incluso a una cuenta bloqueada — es lo que el frontend usa para saber
  // que sigue habiendo sesión y decidir a dónde mandarla.
  @Get('me')
  @SkipSubscriptionGate()
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user);
  }
}
