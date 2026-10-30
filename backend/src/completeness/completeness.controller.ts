import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CompletenessService, type CompletenessOverview, type OfficeCompletenessDetail } from './completeness.service';

/** Setup completitud of the despachos (odd/tasks/role-a-panel.md S10). */
@Controller('completeness')
export class CompletenessController {
  constructor(private readonly completeness: CompletenessService) {}

  /** Role A: every despacho with its percentages and the «Completitud media» KPI. */
  @Get('offices')
  @Roles('A')
  offices(): Promise<CompletenessOverview> {
    return this.completeness.overview();
  }

  /** Role A: «qué falta configurar» in one despacho. */
  @Get('offices/:administratorId')
  @Roles('A')
  office(@Param('administratorId', ParseUUIDPipe) administratorId: string): Promise<OfficeCompletenessDetail> {
    return this.completeness.detail(administratorId);
  }

  /** Role B: its own despacho only, always taken from the token. */
  @Get('office')
  @Roles('B')
  async mine(@CurrentUser() user: AuthenticatedUser): Promise<OfficeCompletenessDetail> {
    if (!user.administratorId) throw new NotFoundException('Tu usuario no está asociado a ningún despacho.');
    return this.completeness.detail(user.administratorId);
  }
}
