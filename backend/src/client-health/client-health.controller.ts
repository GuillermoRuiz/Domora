import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ClientHealthService, type AttentionItem, type ClientHealthOverview, type OfficeHealth } from './client-health.service';

/** Salud, «En riesgo» and «Requieren atención» of the despachos (odd/tasks/role-a-panel.md S14, S7). */
@Controller('client-health')
export class ClientHealthController {
  constructor(private readonly health: ClientHealthService) {}

  /** Role A: every live despacho with salud, «En riesgo» and motivo, plus the «Churn risk» KPI. */
  @Get('offices')
  @Roles('A')
  offices(): Promise<ClientHealthOverview> {
    return this.health.overview();
  }

  /** Role A: one despacho (ficha). */
  @Get('offices/:administratorId')
  @Roles('A')
  office(@Param('administratorId', ParseUUIDPipe) administratorId: string): Promise<OfficeHealth> {
    return this.health.office(administratorId);
  }

  /** Role A: «Requieren atención», most severe first. */
  @Get('attention')
  @Roles('A')
  attention(): Promise<AttentionItem[]> {
    return this.health.attention();
  }
}
