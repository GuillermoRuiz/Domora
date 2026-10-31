/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createPrismaClient } from '../prisma/create-prisma-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import type { AppRole } from '../auth/auth.types';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  linkOwner,
  purgeAdministrator,
} from '../testing/db-fixtures';
import { SUPPORT_SESSION_HEADER } from '../support-access/support-access.guard';
import { IssueWorkflowService } from './issue-workflow.service';

/**
 * Quién puede resolver la decisión de una incidencia desde SU ficha (`POST /issues/:id/tasks/:taskId/resolution`):
 * la gestora B de esa comunidad y soporte (A, sin agenda), nunca el propietario (C) ni otra gestora. Es la misma lógica
 * central que la agenda. Aplicación completa y PostgreSQL real.
 */
jest.setTimeout(180_000);

const prisma = createPrismaClient();
let app: INestApplication<App>;
let jwt: JwtService;
let workflow: IssueWorkflowService;
const API = '/api/v1';

interface Tenant {
  administratorId: string;
  userId: string;
  estateId: string;
  propertyId: string;
  token: string;
}
let T1: Tenant;
let T2: Tenant;
let ownerId: string;
let ownerToken: string;
let supportId: string;
let supportToken: string;

const sign = (
  role: AppRole,
  userId: string,
  administratorId: string | null,
  estateIds: string[],
) => jwt.sign({ sub: userId, role, estateIds, administratorId });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function tenant(name: string): Promise<Tenant> {
  const admin = await createAdministrator(prisma, { name });
  const estateId = await createEstate(prisma, admin.administratorId, {
    name: `${name} · finca`,
  });
  const propertyId = await createProperty(prisma, estateId);
  return {
    administratorId: admin.administratorId,
    userId: admin.userId,
    estateId,
    propertyId,
    token: sign('B', admin.userId, admin.administratorId, [estateId]),
  };
}

beforeAll(async () => {
  process.env.AI_ENABLED = 'false';
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  await app.listen(0);
  jwt = moduleRef.get(JwtService);
  workflow = moduleRef.get(IssueWorkflowService, { strict: false });
  T1 = await tenant('Acceso tareas 1');
  T2 = await tenant('Acceso tareas 2');
  ownerId = await createOwnerUser(prisma, { fullName: 'Propietaria acceso' });
  await linkOwner(prisma, T1.propertyId, ownerId);
  ownerToken = sign('C', ownerId, null, [T1.estateId]);
  supportId = await createOwnerUser(prisma, { fullName: 'Soporte' });
  await prisma.user.update({ where: { id: supportId }, data: { role: 'A' } });
  supportToken = sign('A', supportId, null, []);
});

afterAll(async () => {
  for (const t of [T1, T2]) {
    await prisma.agendaTask.deleteMany({
      where: { administratorId: t.administratorId },
    });
    await prisma.aiJob.deleteMany({ where: { estateId: t.estateId } });
    await prisma.issue.deleteMany({ where: { estateId: t.estateId } });
    await purgeAdministrator(prisma, t.administratorId);
  }
  await prisma.staffAuditLog.deleteMany({ where: { staffUserId: supportId } });
  await prisma.supportSession.deleteMany({ where: { staffUserId: supportId } });
  await prisma.user.deleteMany({ where: { id: { in: [ownerId, supportId] } } });
  await app.close();
  await prisma.$disconnect();
});

const createIssue = async (t: Tenant) => {
  const res = await request(app.getHttpServer())
    .post(`${API}/estates/${t.estateId}/issues`)
    .set(auth(t.token))
    .send({
      type: 'Averia',
      title: 'Ascensor averiado',
      description: 'No funciona',
      priority: 'Normal',
    });
  expect(res.status).toBe(201);
  const issueId = res.body.id as string;
  await prisma.agendaTask.deleteMany({ where: { issueId } });
  const opened = await prisma.$transaction((tx) =>
    workflow.openTask(tx, {
      issueId,
      kind: 'review_issue',
      payload: { reason: 'manual_review' },
      discriminator: 'manual_review',
      createdBy: 'system',
    }),
  );
  return { issueId, taskId: opened.taskId };
};

const followUp = () => ({
  result: {
    decision: 'schedule_follow_up',
    note: 'Llamar',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
});
const resolveVia = (
  issueId: string,
  taskId: string,
  token: string,
  body: object = followUp(),
  headers: Record<string, string> = {},
) =>
  request(app.getHttpServer())
    .post(`${API}/issues/${issueId}/tasks/${taskId}/resolution`)
    .set({ ...auth(token), ...headers })
    .send(body);

describe('POST /issues/:id/tasks/:taskId/resolution', () => {
  it('B (la gestora de la comunidad) resuelve la decisión desde la ficha', async () => {
    const { issueId, taskId } = await createIssue(T1);
    const res = await resolveVia(issueId, taskId, T1.token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: taskId,
      status: 'COMPLETADA',
      outcome: 'done',
    });
  });

  it('A (soporte, sin agenda) también, con sesión de soporte del despacho, y pasa por la misma lógica: se rechaza si deja la incidencia sin siguiente paso', async () => {
    const { issueId, taskId } = await createIssue(T1);
    // La agenda no es de soporte...
    const agenda = await request(app.getHttpServer())
      .get(`${API}/agenda/tasks/${taskId}`)
      .set(auth(supportToken));
    expect(agenda.status).toBe(403);
    // ...y sin sesión de soporte activa en el despacho, A no escribe (solo lectura por defecto).
    const withoutSession = await resolveVia(issueId, taskId, supportToken);
    expect(withoutSession.status).toBe(403);
    const session = await request(app.getHttpServer())
      .post(`${API}/support-sessions`)
      .set(auth(supportToken))
      .send({
        administratorId: T1.administratorId,
        reason: 'Ayuda con una incidencia',
        ticketRef: 'SOP-2',
      })
      .expect(201);
    // ...pero con ella, la decisión de la incidencia sí.
    const withSession = { [SUPPORT_SESSION_HEADER]: session.body.id as string };
    const rejected = await resolveVia(
      issueId,
      taskId,
      supportToken,
      {
        result: { decision: 'done' },
      },
      withSession,
    );
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('ISSUE_NO_NEXT_STEP');
    const ok = await resolveVia(
      issueId,
      taskId,
      supportToken,
      followUp(),
      withSession,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('COMPLETADA');
    const audit = await prisma.issueTimelineEntry.findMany({
      where: { issueId, kind: 'task_resolved' },
    });
    expect(audit.map((e) => e.authorUserId)).toEqual([supportId]);
  });

  it('C (propietario) no puede, ni siquiera de su comunidad', async () => {
    const { issueId, taskId } = await createIssue(T1);
    const res = await resolveVia(issueId, taskId, ownerToken);
    expect(res.status).toBe(403);
    expect(
      (await prisma.agendaTask.findUniqueOrThrow({ where: { id: taskId } }))
        .status,
    ).toBe('PENDIENTE');
  });

  it('otra gestora (B de otra comunidad) es rechazada por la incidencia, como en el resto de rutas de incidencias, y nada cambia', async () => {
    const { issueId, taskId } = await createIssue(T1);
    const cross = await resolveVia(issueId, taskId, T2.token);
    expect(cross.status).toBe(403);
    expect(
      (await prisma.agendaTask.findUniqueOrThrow({ where: { id: taskId } }))
        .status,
    ).toBe('PENDIENTE');
  });

  it('una tarea de OTRA incidencia no se resuelve a través de esta (ni siquiera de la misma gestora)', async () => {
    const one = await createIssue(T1);
    const two = await createIssue(T1);
    const res = await resolveVia(one.issueId, two.taskId, T1.token);
    expect(res.status).toBe(404);
  });

  it('una decisión ya resuelta no se vuelve a resolver (409)', async () => {
    const { issueId, taskId } = await createIssue(T1);
    expect((await resolveVia(issueId, taskId, T1.token)).status).toBe(201);
    expect((await resolveVia(issueId, taskId, T1.token)).status).toBe(409);
  });
});

describe('PATCH /agenda/tasks/:id/status en una revisión de incidencia', () => {
  const complete = (taskId: string, token: string) =>
    request(app.getHttpServer())
      .patch(`${API}/agenda/tasks/${taskId}/status`)
      .set(auth(token))
      .send({ status: 'COMPLETADA' });

  it('«Completada» no cierra una revisión: hay que indicar el siguiente paso (400)', async () => {
    const { taskId } = await createIssue(T1);
    const res = await complete(taskId, T1.token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REVIEW_NEEDS_NEXT_STEP');
    expect(
      (await prisma.agendaTask.findUniqueOrThrow({ where: { id: taskId } }))
        .status,
    ).toBe('PENDIENTE');
  });

  it('con otro siguiente paso se resuelve por su decisión, no por el botón genérico', async () => {
    const { issueId, taskId } = await createIssue(T1);
    // `contact_provider` es el paso de la vía del proveedor: solo cuenta como siguiente paso con esa vía.
    await prisma.issue.update({
      where: { id: issueId },
      data: { resolutionRoute: 'community_provider' },
    });
    await prisma.$transaction((tx) =>
      workflow.openTask(tx, {
        issueId,
        kind: 'review_issue',
        payload: { reason: 'contact_provider' },
        discriminator: 'contact_provider',
        createdBy: 'system',
      }),
    );
    expect((await complete(taskId, T1.token)).status).toBe(400);
    const res = await request(app.getHttpServer())
      .post(`${API}/agenda/tasks/${taskId}/resolution`)
      .set(auth(T1.token))
      .send({ result: { decision: 'next_step_exists' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: taskId,
      status: 'COMPLETADA',
      outcome: 'done',
    });
  });
});
