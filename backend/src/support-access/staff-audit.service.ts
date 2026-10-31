import { Injectable } from '@nestjs/common';
import type { Prisma, StaffAuditAction } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface StaffAuditEntry {
  staffUserId: string;
  administratorId: string | null;
  estateId: string | null;
  supportSessionId: string | null;
  action: StaffAuditAction;
  method: string;
  /** Route TEMPLATE (`estates/:estateId/receipts`), never the concrete URL. */
  route: string;
}

export interface StaffAuditQuery {
  administratorId?: string;
  staffUserId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

/**
 * Accountability trail of Domora staff (role A) access to client data
 * (odd/tasks/role-a-panel.md S5).
 *
 * Writes are SYNCHRONOUS, one INSERT awaited in the request path, and a
 * failure propagates to the caller (the guard then refuses the request).
 * A buffered writer like the usage recorder would lose entries on a crash
 * or a DB outage, and an audit trail that can silently miss an access is
 * not an audit trail. The cost is one indexed INSERT per role A request on
 * a tenant route, a handful of Domora staff, so throughput is not a concern.
 */
@Injectable()
export class StaffAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: StaffAuditEntry): Promise<void> {
    await this.prisma.staffAuditLog.create({ data: entry });
  }

  async list(query: StaffAuditQuery) {
    const where: Prisma.StaffAuditLogWhereInput = {
      ...(query.administratorId
        ? { administratorId: query.administratorId }
        : {}),
      ...(query.staffUserId ? { staffUserId: query.staffUserId } : {}),
      ...(query.from || query.to
        ? {
            occurredAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.staffAuditLog.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.staffAuditLog.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
