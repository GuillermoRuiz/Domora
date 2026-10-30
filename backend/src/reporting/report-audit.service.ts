import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ReportDefinition,
  ReportInput,
  ReportScope,
} from './reporting.types';

/** Uses the existing append-only audit infrastructure, with allowlisted technical metadata. */
@Injectable()
export class ReportAuditService {
  constructor(private readonly prisma: PrismaService) {}
  async record(event: {
    userId: string;
    definition: ReportDefinition;
    input: ReportInput;
    scope?: ReportScope;
    action: 'VIEW' | 'EXPORT';
    format?: 'pdf' | 'xlsx';
    rowCount?: number;
    outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
    requestId: string;
  }): Promise<void> {
    const metadata: Prisma.InputJsonObject = {
      administratorId: event.scope?.administratorId ?? null,
      reportKey: event.definition.key,
      sensitivity: event.definition.sensitivity,
      format: event.format ?? null,
      scopeMode: event.input.scopeMode,
      estateCount:
        event.scope?.estateIds.length ?? event.input.estateIds?.length ?? 0,
      periodFrom: event.input.from ?? null,
      periodTo: event.input.to ?? null,
      asOf: event.input.asOf ?? null,
      fiscalYear: event.input.fiscalYear ?? null,
      rowCount: event.rowCount ?? null,
      outcome: event.outcome,
      requestId: event.requestId,
    };
    try {
      await this.prisma.dataAccessLog.create({
        data: {
          actorUserId: event.userId,
          resource: 'reports',
          resourceId: event.scope?.administratorId ?? null,
          action: event.action,
          detail: event.definition.key,
          metadata,
        },
      });
    } catch {
      // Never return sensitive reports when their access trace could not be stored.
      throw new ServiceUnavailableException(
        'No se ha podido registrar el acceso al informe. Vuelve a intentarlo.',
      );
    }
  }
}
