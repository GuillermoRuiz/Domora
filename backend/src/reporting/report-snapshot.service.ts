import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash, randomUUID } from 'node:crypto';
import type { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ReportFilters,
  ReportInput,
  ReportResult,
  ReportScope,
} from './reporting.types';

const COMPOSITES = new Set(['meeting-finance', 'monthly-executive']);
const RETENTION_MS = 30 * 86400000;
type SnapshotResult = ReportResult & {
  metadata: ReportResult['metadata'] & {
    snapshotId: string;
    snapshotExpiresAt: string;
  };
};

/** Allowlisted canonical business input; transport/output fields never enter
 * the digest. No filter contents or report contents are copied into audit. */
function inputHash(input: ReportInput): string {
  const canonical: Record<string, unknown> = { scopeMode: input.scopeMode };
  if (input.estateIds?.length)
    canonical.estateIds = [...input.estateIds].sort();
  for (const key of [
    'from',
    'to',
    'asOf',
    'fiscalYear',
    'quarter',
    'compareFrom',
    'compareTo',
  ] as const) {
    if (input[key] != null) canonical[key] = input[key];
  }
  const filters: Partial<ReportFilters> = {};
  for (const key of [
    'accountCode',
    'propertyId',
    'supplierId',
    'receiptKind',
    'assignmentMode',
    'spendBasis',
    'days',
  ] as const) {
    const value = input.filters?.[key];
    if (value != null) Object.assign(filters, { [key]: value });
  }
  if (Object.keys(filters).length) canonical.filters = filters;
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function sameScope(left: string[], right: string[]): boolean {
  const a = [...left].sort(),
    b = [...right].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

@Injectable()
export class ReportSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    result: ReportResult,
    input: ReportInput,
    scope: ReportScope,
    actorId: string,
  ): Promise<SnapshotResult> {
    if (!COMPOSITES.has(result.metadata.reportKey))
      throw new ConflictException(
        'Este informe no admite una fotografía persistida.',
      );
    if (actorId !== scope.user.id || !scope.estateIds.length)
      throw new ForbiddenException(
        'El ámbito de la fotografía no está autorizado.',
      );
    const generatedAt = new Date(result.metadata.generatedAt);
    if (!Number.isFinite(generatedAt.getTime()))
      throw new ConflictException('La fecha de generación no es válida.');
    // Also runs when scheduled jobs are disabled in local/demo installations.
    await this.prisma.reportSnapshot.deleteMany({
      where: {
        administratorId: scope.administratorId,
        expiresAt: { lte: new Date() },
      },
    });
    const expiresAt = new Date(generatedAt.getTime() + RETENTION_MS);
    const id = randomUUID();
    const stored: SnapshotResult = JSON.parse(
      JSON.stringify({
        ...result,
        metadata: {
          ...result.metadata,
          snapshotId: id,
          snapshotExpiresAt: expiresAt.toISOString(),
        },
      }),
    );
    await this.prisma.reportSnapshot.create({
      data: {
        id,
        administratorId: scope.administratorId,
        createdByUserId: actorId,
        reportKey: result.metadata.reportKey,
        estateIds: [...scope.estateIds].sort(),
        inputHash: inputHash(input),
        result: stored as unknown as Prisma.InputJsonValue,
        generatedAt,
        expiresAt,
      },
    });
    return stored;
  }

  /** Caller must resolve fresh DB scope again before invoking this method. */
  async load(
    id: string,
    key: string,
    input: ReportInput,
    scope: ReportScope,
    actorId: string,
  ): Promise<ReportResult> {
    const snapshot = await this.prisma.reportSnapshot.findUnique({
      where: { id },
    });
    if (
      !snapshot ||
      snapshot.reportKey !== key ||
      !COMPOSITES.has(key) ||
      snapshot.expiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundException(
        'La fotografía no existe o ha caducado. Genera el informe de nuevo.',
      );
    }
    if (
      snapshot.administratorId !== scope.administratorId ||
      snapshot.createdByUserId !== actorId ||
      actorId !== scope.user.id ||
      !sameScope(snapshot.estateIds, scope.estateIds)
    ) {
      throw new ForbiddenException(
        'La fotografía no pertenece al ámbito autorizado.',
      );
    }
    if (snapshot.inputHash !== inputHash(input))
      throw new ConflictException(
        'Los filtros han cambiado. Genera una nueva fotografía del informe.',
      );
    return snapshot.result as unknown as ReportResult;
  }

  /** Access expires at 30 days; physical cleanup runs daily (and on create).
   * No report data, actor names or document content are logged. */
  @Cron('0 3 * * *', {
    name: 'report-snapshots-retention',
    timeZone: 'Europe/Madrid',
  })
  async purgeExpired(): Promise<void> {
    await this.prisma.reportSnapshot.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
  }
}
