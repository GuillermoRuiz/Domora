import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { EstateScopeGuard } from '../estate-access/estate-scope.guard';
import { InvariantsService } from './invariants.service';

/**
 * Endpoint de integridad (fase 13): todas las invariantes de la contabilidad
 * de una finca de un vistazo — errores duros (nunca deberían darse) y
 * avisos de negocio (normales en mitad de un flujo, pero que conviene que
 * la gestora vea). Ver el comentario de clase de `InvariantsService`.
 */
@Controller('estates/:estateId/ledger')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class LedgerIntegrityController {
  constructor(private readonly invariants: InvariantsService) {}

  @Get('integrity')
  async integrity(@Param('estateId') estateId: string) {
    const issues = await this.invariants.checkAll(estateId);
    return {
      ok: issues.every((i) => i.severity !== 'error'),
      issues,
    };
  }
}
