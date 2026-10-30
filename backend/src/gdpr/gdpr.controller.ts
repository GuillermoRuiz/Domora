import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { GdprService } from './gdpr.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';

@Controller('gdpr/me')
export class GdprController {
  constructor(private readonly gdprService: GdprService) {}

  /** Portabilidad (art. 20 RGPD): export JSON de los datos del usuario. */
  @Get('export')
  export(@CurrentUser() user: AuthenticatedUser) {
    return this.gdprService.exportMyData(user);
  }

  /** Supresión (art. 17 RGPD) con retención legal — ver doc/compliance/rgpd.md. */
  @Post('erasure')
  @HttpCode(HttpStatus.OK)
  erase(@CurrentUser() user: AuthenticatedUser) {
    return this.gdprService.eraseMyAccount(user);
  }
}
