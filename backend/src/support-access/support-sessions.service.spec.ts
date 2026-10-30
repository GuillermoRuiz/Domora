import { NotFoundException } from '@nestjs/common';
import { SupportSessionsService, SUPPORT_SESSION_TTL_MS } from './support-sessions.service';
import type { StaffAuditService } from './staff-audit.service';
import type { PrismaService } from '../prisma/prisma.service';

const STAFF = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-26T10:00:00.000Z');

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    administrator: { findFirst: jest.fn().mockResolvedValue({ id: ADMIN }) },
    supportSession: {
      create: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: SESSION, endedAt: null, ...args.data }),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn((args: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: SESSION, administratorId: ADMIN, ...args.data }),
      ),
    },
    ...overrides,
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new SupportSessionsService(
    prisma,
    audit as unknown as StaffAuditService,
    () => NOW,
  );
  return { prisma, audit, service };
}

describe('SupportSessionsService', () => {
  it('starts a 2 h session on an existing despacho and audits it', async () => {
    const { prisma, audit, service } = build();
    const session = await service.start(STAFF, {
      administratorId: ADMIN,
      reason: 'Cuadrar el banco',
      ticketRef: 'SOP-12',
    });
    expect(SUPPORT_SESSION_TTL_MS).toBe(2 * 60 * 60 * 1000);
    expect(prisma.supportSession.create).toHaveBeenCalledWith({
      data: {
        staffUserId: STAFF,
        administratorId: ADMIN,
        reason: 'Cuadrar el banco',
        ticketRef: 'SOP-12',
        startedAt: NOW,
        expiresAt: new Date(NOW.getTime() + SUPPORT_SESSION_TTL_MS),
      },
    });
    expect(session.id).toBe(SESSION);
    expect(audit.record).toHaveBeenCalledWith({
      staffUserId: STAFF,
      administratorId: ADMIN,
      estateId: null,
      supportSessionId: SESSION,
      action: 'support_start',
      method: 'POST',
      route: 'support-sessions',
    });
  });

  it('refuses a despacho that does not exist or was deleted', async () => {
    const { prisma, audit, service } = build({
      administrator: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.start(STAFF, { administratorId: ADMIN, reason: 'x' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.supportSession.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('ends only the caller session and audits it', async () => {
    const { prisma, audit, service } = build();
    (prisma.supportSession.findFirst as jest.Mock).mockResolvedValue({
      id: SESSION,
      staffUserId: STAFF,
      administratorId: ADMIN,
      endedAt: null,
    });
    await service.end(STAFF, SESSION);
    expect(prisma.supportSession.findFirst).toHaveBeenCalledWith({
      where: { id: SESSION, staffUserId: STAFF },
    });
    expect(prisma.supportSession.update).toHaveBeenCalledWith({
      where: { id: SESSION },
      data: { endedAt: NOW },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support_end',
        supportSessionId: SESSION,
        administratorId: ADMIN,
        route: 'support-sessions/:id/end',
      }),
    );
  });

  it('answers 404 for a foreign or unknown session', async () => {
    const { audit, service } = build();
    await expect(service.end(STAFF, SESSION)).rejects.toThrow(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lists only the caller sessions still active', async () => {
    const { prisma, service } = build();
    await service.listActive(STAFF);
    expect(prisma.supportSession.findMany).toHaveBeenCalledWith({
      where: { staffUserId: STAFF, endedAt: null, expiresAt: { gt: NOW } },
      orderBy: { startedAt: 'desc' },
    });
  });

  it('finds a valid session only for its owner, not ended and not expired', async () => {
    const { prisma, service } = build();
    await service.findValid(SESSION, STAFF);
    expect(prisma.supportSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: SESSION,
        staffUserId: STAFF,
        endedAt: null,
        expiresAt: { gt: NOW },
      },
    });
  });
});
