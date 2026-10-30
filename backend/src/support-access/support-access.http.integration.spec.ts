/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { createHash } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import type { AppRole } from '../auth/auth.types';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  purgeAdministrator,
  uniqueEmail,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { SUPPORT_MESSAGES } from './support-access.guard';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Role A access model through HTTP with the COMPLETE application (global
 * JwtAuthGuard → RolesGuard → SupportAccessGuard → subscription → throttler,
 * ValidationPipe as in main.ts) and real PostgreSQL
 * (odd/tasks/role-a-panel.md S5).
 */
jest.setTimeout(120_000);

const prisma = createPrismaClient();
let app: INestApplication<App>;
let jwt: JwtService;
const API = '/api/v1';

let X: AdministratorFixture;
let Y: AdministratorFixture;
let estateX: string;
let estateY: string;
let staffId: string;
let otherStaffId: string;
let ownerId: string;
let tokenA: string;
let tokenOtherA: string;
let tokenB: string;
let tokenC: string;

function sign(role: AppRole, userId: string, administratorId: string | null, estateIds: string[]): string {
  return jwt.sign({ sub: userId, role, estateIds, administratorId });
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const communication = { title: 'Corte de agua', body: 'Mañana de 9 a 11.' };

function auditRows(staffUserId: string) {
  return prisma.staffAuditLog.findMany({ where: { staffUserId }, orderBy: { occurredAt: 'asc' } });
}

async function readRows(staffUserId: string) {
  return (await auditRows(staffUserId)).filter((r) => r.action === 'read');
}

async function startSession(token: string, administratorId: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post(`${API}/support-sessions`)
    .set(auth(token))
    .send({ administratorId, reason: 'Ayuda con un comunicado', ticketRef: 'SOP-1' })
    .expect(201);
  return res.body.id as string;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  await app.listen(0);
  jwt = moduleRef.get(JwtService);

  X = await createAdministrator(prisma, { name: 'Soporte HTTP · Despacho X' });
  Y = await createAdministrator(prisma, { name: 'Soporte HTTP · Despacho Y' });
  estateX = await createEstate(prisma, X.administratorId, { name: 'Soporte X · finca' });
  estateY = await createEstate(prisma, Y.administratorId, { name: 'Soporte Y · finca' });
  const staff = await prisma.user.create({
    data: { email: uniqueEmail('staff'), passwordHash: 'x', fullName: 'Staff Domora', role: 'A' },
  });
  const otherStaff = await prisma.user.create({
    data: { email: uniqueEmail('staff2'), passwordHash: 'x', fullName: 'Otro staff', role: 'A' },
  });
  staffId = staff.id;
  otherStaffId = otherStaff.id;
  ownerId = await createOwnerUser(prisma);
  tokenA = sign('A', staffId, null, []);
  tokenOtherA = sign('A', otherStaffId, null, []);
  tokenB = sign('B', X.userId, X.administratorId, [estateX]);
  tokenC = sign('C', ownerId, null, [estateX]);
});

afterEach(async () => {
  await prisma.staffAuditLog.deleteMany({ where: { staffUserId: { in: [staffId, otherStaffId, X.userId, ownerId] } } });
  await prisma.supportSession.deleteMany({ where: { staffUserId: { in: [staffId, otherStaffId] } } });
});

afterAll(async () => {
  const estateIds = [estateX, estateY];
  const people = [staffId, otherStaffId, ownerId, X.userId, Y.userId];
  const conversations = await prisma.directMessageParticipant.findMany({
    where: { userId: { in: people } },
    select: { conversationId: true },
  });
  const conversationIds = [...new Set(conversations.map((c) => c.conversationId))];
  await prisma.directMessage.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  // Each sign-up request now also creates a lead (T10); the lead survives the request (SetNull), so delete it first.
  const requests = await prisma.estateOnboardingRequest.findMany({ where: { requestedByUserId: { in: people } }, select: { id: true } });
  await prisma.lead.deleteMany({ where: { onboardingRequestId: { in: requests.map((r) => r.id) } } });
  await prisma.estateOnboardingRequest.deleteMany({ where: { requestedByUserId: { in: people } } });
  await prisma.notification.deleteMany({ where: { userId: { in: people } } });
  await prisma.activityLogEntry.deleteMany({ where: { actorUserId: { in: people } } });
  await prisma.activityLogEntry.deleteMany({ where: { estateId: { in: estateIds } } });
  await prisma.communication.deleteMany({ where: { estateId: { in: estateIds } } });
  await purgeAdministrator(prisma, X.administratorId);
  await purgeAdministrator(prisma, Y.administratorId);
  await prisma.refreshToken.deleteMany({ where: { userId: { in: [staffId, otherStaffId, ownerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [staffId, otherStaffId, ownerId] } } });
  await app.close();
  await prisma.$disconnect();
});

describe('role A on tenant routes', () => {
  it('cannot read without a support session (403) and the denial is audited', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/estates/${estateX}/cost-centres`)
      .set(auth(tokenA))
      .expect(403);
    expect(res.body.message).toBe(SUPPORT_MESSAGES.noSession);
    const rows = await auditRows(staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'denied', method: 'GET', route: 'estates/:estateId/cost-centres', administratorId: X.administratorId });
  });

  it('reads (200) inside a support session of the despacho and the read is audited with the route template, despacho and session', async () => {
    const sessionId = await startSession(tokenA, X.administratorId);
    await request(app.getHttpServer())
      .get(`${API}/estates/${estateX}/cost-centres?foo=bar`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionId)
      .expect(200);
    const rows = await readRows(staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'read',
      method: 'GET',
      route: 'estates/:estateId/cost-centres',
      administratorId: X.administratorId,
      estateId: estateX,
      supportSessionId: sessionId,
    });
  });

  it('cannot read another despacho with the session of this one (403)', async () => {
    const sessionId = await startSession(tokenA, X.administratorId);
    const res = await request(app.getHttpServer())
      .get(`${API}/estates/${estateY}/cost-centres`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionId)
      .expect(403);
    expect(res.body.message).toBe(SUPPORT_MESSAGES.otherDespacho);
  });

  it('cannot write without a support session (403) and the denial is audited', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/communications`)
      .set(auth(tokenA))
      .send(communication)
      .expect(403);
    expect(res.body.message).toBe(SUPPORT_MESSAGES.noSession);
    expect(await prisma.communication.count({ where: { estateId: estateX, authorUserId: staffId } })).toBe(0);
    const rows = await auditRows(staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'denied',
      method: 'POST',
      route: 'estates/:estateId/communications',
      administratorId: X.administratorId,
      estateId: estateX,
    });
  });

  it('cannot write through a route without @Roles either (PATCH estates/:estateId)', async () => {
    const before = await prisma.estate.findUniqueOrThrow({ where: { id: estateX } });
    const res = await request(app.getHttpServer())
      .patch(`${API}/estates/${estateX}`)
      .set(auth(tokenA))
      .send({ name: 'Renombrada por staff' })
      .expect(403);
    expect(res.body.message).toBe(SUPPORT_MESSAGES.noSession);
    expect((await prisma.estate.findUniqueOrThrow({ where: { id: estateX } })).name).toBe(before.name);
  });

  it('writes with a valid support session of the despacho, audited as write', async () => {
    const sessionId = await startSession(tokenA, X.administratorId);
    const res = await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/communications`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionId)
      .send(communication)
      .expect(201);
    expect(res.body.title).toBe(communication.title);
    const rows = await auditRows(staffId);
    expect(rows.map((r) => r.action)).toEqual(['support_start', 'write']);
    expect(rows[0]).toMatchObject({ route: 'support-sessions', administratorId: X.administratorId, supportSessionId: sessionId });
    expect(rows[1]).toMatchObject({
      method: 'POST',
      route: 'estates/:estateId/communications',
      administratorId: X.administratorId,
      estateId: estateX,
      supportSessionId: sessionId,
    });
  });

  it.each([
    ['of another despacho', 'other'],
    ['of another staff user', 'foreign'],
    ['already ended', 'ended'],
    ['expired', 'expired'],
    ['unknown', 'unknown'],
  ])('refuses a session %s', async (_label, kind) => {
    let sessionId: string;
    let message: string = SUPPORT_MESSAGES.invalidSession;
    if (kind === 'other') {
      sessionId = await startSession(tokenA, Y.administratorId);
      message = SUPPORT_MESSAGES.otherDespacho;
    } else if (kind === 'foreign') {
      sessionId = await startSession(tokenOtherA, X.administratorId);
    } else if (kind === 'ended') {
      sessionId = await startSession(tokenA, X.administratorId);
      await request(app.getHttpServer()).post(`${API}/support-sessions/${sessionId}/end`).set(auth(tokenA)).expect(201);
    } else if (kind === 'expired') {
      sessionId = await startSession(tokenA, X.administratorId);
      await prisma.supportSession.update({ where: { id: sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    } else {
      sessionId = '00000000-0000-4000-8000-000000000000';
    }
    const authored = () => prisma.communication.count({ where: { estateId: estateX, authorUserId: staffId } });
    const before = await authored();
    const res = await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/communications`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionId)
      .send(communication)
      .expect(403);
    expect(res.body.message).toBe(message);
    expect(await authored()).toBe(before);
    const denied = (await auditRows(staffId)).filter((r) => r.action === 'denied');
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ route: 'estates/:estateId/communications', administratorId: X.administratorId });
  });

  it('is unaffected on platform routes (no audit row)', async () => {
    await request(app.getHttpServer()).get(`${API}/platform-metrics/activity?limit=1`).set(auth(tokenA)).expect(200);
    expect(await auditRows(staffId)).toHaveLength(0);
  });
});

describe('Domora relation with its clients (self routes, no support session)', () => {
  it('role A resolves a community sign-up request without a session and nothing is audited; B stays refused', async () => {
    const created = await request(app.getHttpServer())
      .post(`${API}/estate-onboarding-requests`)
      .set(auth(tokenC))
      .send({ communityName: 'Comunidad nueva de prueba' })
      .expect(201);
    const id = created.body.id as string;
    await request(app.getHttpServer())
      .patch(`${API}/estate-onboarding-requests/${id}`)
      .set(auth(tokenB))
      .send({ status: 'contacted' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`${API}/estate-onboarding-requests/${id}`)
      .set(auth(tokenA))
      .send({ status: 'contacted' })
      .expect(200);
    const row = await prisma.estateOnboardingRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('contacted');
    expect(row.resolvedByUserId).toBe(staffId);
    expect(await auditRows(staffId)).toHaveLength(0);
    expect(await prisma.staffAuditLog.count({ where: { staffUserId: { in: [ownerId, X.userId] } } })).toBe(0);
  });

  it('role A sends a direct message without a session and nothing is audited; B replies unchanged', async () => {
    const conversation = await prisma.conversation.create({
      data: { participants: { create: [{ userId: staffId }, { userId: X.userId }] } },
      select: { id: true },
    });
    const sent = await request(app.getHttpServer())
      .post(`${API}/direct-messages/messages`)
      .set(auth(tokenA))
      .send({ conversationId: conversation.id, text: 'Hola, soy soporte de Domora.' })
      .expect(201);
    expect(sent.body.senderId).toBe(staffId);
    await request(app.getHttpServer())
      .post(`${API}/direct-messages/messages`)
      .set(auth(tokenB))
      .send({ conversationId: conversation.id, text: 'Gracias.' })
      .expect(201);
    expect(await prisma.directMessage.count({ where: { conversationId: conversation.id } })).toBe(2);
    expect(await auditRows(staffId)).toHaveLength(0);
    expect(await prisma.staffAuditLog.count({ where: { staffUserId: X.userId } })).toBe(0);
  });
});

describe('read-only POST routes', () => {
  it('role A previews coefficients by area inside a support session, audited as read', async () => {
    await createProperty(prisma, estateX, { builtAreaM2: '80.00' });
    await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/properties/coefficients/preview-by-area`)
      .set(auth(tokenA))
      .expect(403);
    const sessionId = await startSession(tokenA, X.administratorId);
    const res = await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/properties/coefficients/preview-by-area`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionId)
      .expect(201);
    expect(res.body.rows).toHaveLength(1);
    const rows = await readRows(staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'read',
      method: 'POST',
      route: 'estates/:estateId/properties/coefficients/preview-by-area',
      administratorId: X.administratorId,
      estateId: estateX,
      supportSessionId: sessionId,
    });
  });

  it('applying the same coefficients is still a write that needs a session', async () => {
    const res = await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/properties/coefficients/apply-by-area`)
      .set(auth(tokenA))
      .expect(403);
    expect(res.body.message).toBe(SUPPORT_MESSAGES.noSession);
  });
});

describe('support sessions and audit endpoints', () => {
  it('logging out ends the open support sessions of the staff user and audits it (L44: "cerrar automaticamente")', async () => {
    const refreshToken = `logout-${staffId}`;
    await prisma.refreshToken.create({
      data: {
        userId: staffId,
        tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await startSession(tokenA, X.administratorId);

    await request(app.getHttpServer()).post(`${API}/auth/logout`).send({ refreshToken }).expect(204);

    expect(await prisma.supportSession.count({ where: { staffUserId: staffId, endedAt: null } })).toBe(0);
    expect((await auditRows(staffId)).map((r) => r.action)).toEqual(['support_start', 'support_end']);
  });

  it('starts, lists, ends a session and audits start and end', async () => {
    const sessionId = await startSession(tokenA, X.administratorId);
    const active = await request(app.getHttpServer()).get(`${API}/support-sessions/active`).set(auth(tokenA)).expect(200);
    expect(active.body.map((s: { id: string }) => s.id)).toEqual([sessionId]);
    const expires = new Date(active.body[0].expiresAt).getTime() - new Date(active.body[0].startedAt).getTime();
    expect(expires).toBe(2 * 60 * 60 * 1000);
    await request(app.getHttpServer()).post(`${API}/support-sessions/${sessionId}/end`).set(auth(tokenA)).expect(201);
    const after = await request(app.getHttpServer()).get(`${API}/support-sessions/active`).set(auth(tokenA)).expect(200);
    expect(after.body).toEqual([]);
    expect((await auditRows(staffId)).map((r) => r.action)).toEqual(['support_start', 'support_end']);
  });

  it('requires a reason and an existing despacho', async () => {
    await request(app.getHttpServer())
      .post(`${API}/support-sessions`)
      .set(auth(tokenA))
      .send({ administratorId: X.administratorId, reason: '   ' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${API}/support-sessions`)
      .set(auth(tokenA))
      .send({ administratorId: '00000000-0000-4000-8000-000000000000', reason: 'x' })
      .expect(404);
    expect(await auditRows(staffId)).toHaveLength(0);
  });

  it('is role A only', async () => {
    await request(app.getHttpServer())
      .post(`${API}/support-sessions`)
      .set(auth(tokenB))
      .send({ administratorId: X.administratorId, reason: 'x' })
      .expect(403);
    await request(app.getHttpServer()).get(`${API}/staff-audit`).set(auth(tokenB)).expect(403);
  });

  it('pages and filters the audit log by despacho and staff', async () => {
    const sessionX = await startSession(tokenA, X.administratorId);
    const sessionY = await startSession(tokenA, Y.administratorId);
    await request(app.getHttpServer()).get(`${API}/estates/${estateX}/cost-centres`).set(auth(tokenA)).set('X-Support-Session', sessionX).expect(200);
    await request(app.getHttpServer()).get(`${API}/estates/${estateY}/cost-centres`).set(auth(tokenA)).set('X-Support-Session', sessionY).expect(200);
    const res = await request(app.getHttpServer())
      .get(`${API}/staff-audit?administratorId=${X.administratorId}&staffUserId=${staffId}&pageSize=10`)
      .set(auth(tokenA))
      .expect(200);
    // The start of the session of X and the read of X.
    expect(res.body.total).toBe(2);
    expect(res.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ estateId: estateX, action: 'read' })]));
    await request(app.getHttpServer()).get(`${API}/staff-audit?administratorId=nope`).set(auth(tokenA)).expect(400);
  });
});

describe('roles B and C are unaffected', () => {
  it('B writes on a tenant route without any session and nothing is audited', async () => {
    await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/cost-centres`)
      .set(auth(tokenB))
      .send({ name: 'Piscina' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/communications`)
      .set(auth(tokenB))
      .send(communication)
      .expect(201);
    expect(await prisma.staffAuditLog.count({ where: { staffUserId: X.userId } })).toBe(0);
  });

  it('C writes on a tenant route without any session and nothing is audited', async () => {
    await request(app.getHttpServer())
      .post(`${API}/estates/${estateX}/communications`)
      .set(auth(tokenC))
      .send(communication)
      .expect(201);
    expect(await prisma.staffAuditLog.count({ where: { staffUserId: ownerId } })).toBe(0);
  });

  it('B is still scoped to its own estates', async () => {
    await request(app.getHttpServer()).get(`${API}/estates/${estateY}/cost-centres`).set(auth(tokenB)).expect(403);
  });
});

describe('despacho filter on estate listings', () => {
  it('role A lists only the estates of ?administratorId=', async () => {
    const sessionX = await startSession(tokenA, X.administratorId);
    const sessionY = await startSession(tokenA, Y.administratorId);
    const res = await request(app.getHttpServer())
      .get(`${API}/estates?administratorId=${X.administratorId}`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionX)
      .expect(200);
    expect(res.body.map((e: { id: string }) => e.id)).toEqual([estateX]);
    const overview = await request(app.getHttpServer())
      .get(`${API}/estates/overview?administratorId=${Y.administratorId}&pageSize=60`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionY)
      .expect(200);
    expect(overview.body.items.map((e: { id: string }) => e.id)).toEqual([estateY]);
    const reads = await readRows(staffId);
    expect(reads.map((r) => [r.route, r.administratorId])).toEqual([
      ['estates', X.administratorId],
      ['estates/overview', Y.administratorId],
    ]);
  });

  it('role A cannot list estates without the filter, even inside a session (it would cross despachos)', async () => {
    const sessionX = await startSession(tokenA, X.administratorId);
    await request(app.getHttpServer()).get(`${API}/estates`).set(auth(tokenA)).expect(403);
    for (const path of ['estates', 'estates/overview']) {
      const res = await request(app.getHttpServer()).get(`${API}/${path}`).set(auth(tokenA)).set('X-Support-Session', sessionX).expect(403);
      expect(res.body.message).toBe(SUPPORT_MESSAGES.unresolved);
    }
  });

  it('cannot list another despacho with the session of this one', async () => {
    const sessionX = await startSession(tokenA, X.administratorId);
    await request(app.getHttpServer())
      .get(`${API}/estates?administratorId=${Y.administratorId}`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionX)
      .expect(403);
  });

  it('rejects a filter that is not a UUID', async () => {
    const sessionX = await startSession(tokenA, X.administratorId);
    await request(app.getHttpServer()).get(`${API}/estates?administratorId=nope`).set(auth(tokenA)).set('X-Support-Session', sessionX).expect(400);
    await request(app.getHttpServer()).get(`${API}/estates/overview?administratorId=nope`).set(auth(tokenA)).set('X-Support-Session', sessionX).expect(400);
  });

  it('keeps ignoring a malformed filter for role B, as before the despacho filter existed', async () => {
    const res = await request(app.getHttpServer()).get(`${API}/estates?administratorId=nope`).set(auth(tokenB)).expect(200);
    expect(res.body.map((e: { id: string }) => e.id)).toEqual([estateX]);
    const overview = await request(app.getHttpServer()).get(`${API}/estates/overview?administratorId=nope`).set(auth(tokenB)).expect(200);
    expect(overview.body.items.map((e: { id: string }) => e.id)).toEqual([estateX]);
    await request(app.getHttpServer()).get(`${API}/estates/overview/export.xlsx?administratorId=nope`).set(auth(tokenB)).expect(200);
  });

  it('setup summary: role A gets the selected despacho (audited as read), nothing without it, 400 when malformed', async () => {
    const sessionY = await startSession(tokenA, Y.administratorId);
    const res = await request(app.getHttpServer())
      .get(`${API}/estates/setup-summary?administratorId=${Y.administratorId}`)
      .set(auth(tokenA))
      .set('X-Support-Session', sessionY)
      .expect(200);
    expect(res.body.map((s: { estateId: string }) => s.estateId)).toEqual([estateY]);
    const empty = await request(app.getHttpServer()).get(`${API}/estates/setup-summary`).set(auth(tokenA)).set('X-Support-Session', sessionY).expect(200);
    expect(empty.body).toEqual([]);
    await request(app.getHttpServer()).get(`${API}/estates/setup-summary?administratorId=nope`).set(auth(tokenA)).set('X-Support-Session', sessionY).expect(400);
    const reads = await readRows(staffId);
    expect(reads[0]).toMatchObject({ action: 'read', method: 'GET', route: 'estates/setup-summary', administratorId: Y.administratorId });
  });

  it('setup summary: role B keeps its own despacho and ignores the parameter, even malformed', async () => {
    for (const query of [`?administratorId=${Y.administratorId}`, '?administratorId=nope', '']) {
      const res = await request(app.getHttpServer()).get(`${API}/estates/setup-summary${query}`).set(auth(tokenB)).expect(200);
      expect(res.body.map((s: { estateId: string }) => s.estateId)).toEqual([estateX]);
    }
  });

  it('ignores the filter for role B (own estates only)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/estates?administratorId=${Y.administratorId}`)
      .set(auth(tokenB))
      .expect(200);
    expect(res.body.map((e: { id: string }) => e.id)).toEqual([estateX]);
    const overview = await request(app.getHttpServer())
      .get(`${API}/estates/overview?administratorId=${Y.administratorId}`)
      .set(auth(tokenB))
      .expect(200);
    expect(overview.body.items.map((e: { id: string }) => e.id)).toEqual([estateX]);
  });
});
