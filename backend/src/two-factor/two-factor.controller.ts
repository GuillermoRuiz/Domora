import { Body, Controller, Get, Post } from '@nestjs/common';
import { TwoFactorService } from './two-factor.service';
import { VerifyEnableTwoFactorDto } from './dto/verify-enable-two-factor.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

// Sin @Roles: cualquier rol activa/desactiva 2FA sobre su PROPIA cuenta —
// no hay noción de "gestionar el 2FA de otro usuario".
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Get('status')
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.status(user.id);
  }

  @Post('enroll')
  enroll(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.generateEnrollment(user.id);
  }

  @Post('verify-enable')
  verifyEnable(@Body() dto: VerifyEnableTwoFactorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.verifyAndEnable(user.id, dto.secret, dto.code);
  }

  @Post('disable')
  disable(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.disable(user.id);
  }

  @Post('backup-codes/regenerate')
  regenerateBackupCodes(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactor.regenerateBackupCodes(user.id);
  }
}
