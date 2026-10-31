import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { SupportSession } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StaffAuditService } from './staff-audit.service';

/** A support session lasts 2 hours unless it is ended earlier. */
export const SUPPORT_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** Injection token for the clock, so tests can pin «now». */
export const SUPPORT_CLOCK = 'SUPPORT_CLOCK';

export interface StartSupportSession {
  administratorId: string;
  reason: string;
  ticketRef?: string;
}

/**
 * Explicit support mode of Domora staff on one despacho
 * (odd/tasks/role-a-panel.md S5). Starting and ending a session are audited.
 */
@Injectable()
export class SupportSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: StaffAuditService,
    @Optional()
    @Inject(SUPPORT_CLOCK)
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(
    staffUserId: string,
    input: StartSupportSession,
  ): Promise<SupportSession> {
    const office = await this.prisma.administrator.findFirst({
      where: { id: input.administratorId, deletedAt: null },
      select: { id: true },
    });
    if (!office) throw new NotFoundException('El despacho no existe.');
    const startedAt = this.now();
    const session = await this.prisma.supportSession.create({
      data: {
        staffUserId,
        administratorId: input.administratorId,
        reason: input.reason,
        ticketRef: input.ticketRef ?? null,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + SUPPORT_SESSION_TTL_MS),
      },
    });
    try {
      await this.audit.record({
        staffUserId,
        administratorId: input.administratorId,
        estateId: null,
        supportSessionId: session.id,
        action: 'support_start',
        method: 'POST',
        route: 'support-sessions',
      });
    } catch (error) {
      // An unaudited session must never be usable: close it and fail.
      await this.prisma.supportSession
        .update({ where: { id: session.id }, data: { endedAt: this.now() } })
        .catch(() => undefined);
      throw error;
    }
    return session;
  }

  /** Ends every open session of a staff user (logout): each one is audited like a manual end. */
  async endAllForStaff(staffUserId: string): Promise<number> {
    const open = await this.prisma.supportSession.findMany({
      where: { staffUserId, endedAt: null, expiresAt: { gt: this.now() } },
      select: { id: true },
    });
    for (const { id } of open) await this.end(staffUserId, id);
    return open.length;
  }

  async end(staffUserId: string, id: string): Promise<SupportSession> {
    const session = await this.prisma.supportSession.findFirst({
      where: { id, staffUserId },
    });
    if (!session)
      throw new NotFoundException('La sesión de soporte no existe.');
    const ended = session.endedAt
      ? session
      : await this.prisma.supportSession.update({
          where: { id },
          data: { endedAt: this.now() },
        });
    await this.audit.record({
      staffUserId,
      administratorId: session.administratorId,
      estateId: null,
      supportSessionId: id,
      action: 'support_end',
      method: 'POST',
      route: 'support-sessions/:id/end',
    });
    return ended;
  }

  listActive(staffUserId: string): Promise<SupportSession[]> {
    return this.prisma.supportSession.findMany({
      where: { staffUserId, endedAt: null, expiresAt: { gt: this.now() } },
      orderBy: { startedAt: 'desc' },
    });
  }

  /** The caller's own session, not ended and not expired; otherwise null. */
  findValid(id: string, staffUserId: string): Promise<SupportSession | null> {
    return this.prisma.supportSession.findFirst({
      where: { id, staffUserId, endedAt: null, expiresAt: { gt: this.now() } },
    });
  }
}
