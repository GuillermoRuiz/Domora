import { Global, Module } from '@nestjs/common';
import { GdprController } from './gdpr.controller';
import { GdprService } from './gdpr.service';
import { AuditService } from './audit.service';

/**
 * Global: AuditService se inyecta desde los módulos que exponen datos
 * sensibles (SEPA, morosidad) sin re-importar el módulo en cada uno.
 */
@Global()
@Module({
  controllers: [GdprController],
  providers: [GdprService, AuditService],
  exports: [AuditService],
})
export class GdprModule {}
