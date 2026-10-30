/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'node:crypto';
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
  purgeAdministrator,
} from '../testing/db-fixtures';
import { IssueWorkflowService } from './issue-workflow.service';
import {
  ISSUE_SITUATION_FILTERS,
  ISSUE_SITUATION_FILTER_KEYS,
} from './issue-situation';
import { renderRequesterMessage } from './requester-messages';

/**
 * Dos añadidos que usa la pantalla de Incidencias, con la aplicación completa y PostgreSQL real:
 *  - `GET /estates/:id/issues?situation=` filtra por la MISMA proyección que el detalle y el resumen
 *    (`ISSUE_SITUATION_FILTERS`, única fuente de verdad) y pagina sobre el resultado;
 *  - `POST /issues/:id/requester-notices/preview` devuelve el texto exacto del aviso al solicitante, con el mismo
 *    renderizado que el envío real, sin enviar nada ni crear eventos.
 */
jest.setTimeout(180_000);

const prisma = createPrismaClient();
const API = '/api/v1';
let app: INestApplication<App>;
let jwt: JwtService;
let workflow: IssueWorkflowService;

interface Tenant {
  administratorId: string;
  userId: string;
  estateId: string;
  propertyId: string;
  token: string;
}
let A: Tenant;
let B: Tenant;
let ownerId: string;
let ownerToken: string;

const sign = (
  role: AppRole,
  userId: string,
  administratorId: string | null,
  estateIds: string[],
) => jwt.sign({ sub: userId, role, estateIds, administratorId });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const http = () => request(app.getHttpServer());

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

const AI_ENV = { AI_ENABLED: 'true', AI_DEV_MOCK_PROVIDER: 'true' };
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(AI_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
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
  A = await tenant('Filtro situación A');
  B = await tenant('Filtro situación B');
  ownerId = await createOwnerUser(prisma, { fullName: 'Propietaria filtro' });
  ownerToken = sign('C', ownerId, null, [A.estateId]);
});

afterAll(async () => {
  for (const t of [A, B]) {
    await prisma.agendaTask.deleteMany({
      where: { administratorId: t.administratorId },
    });
    await prisma.aiJob.deleteMany({ where: { estateId: t.estateId } });
    await prisma.issue.deleteMany({
      where: { estateId: t.estateId },
    });
    await purgeAdministrator(prisma, t.administratorId);
  }
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await app.close();
  await prisma.$disconnect();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

let counter = 0;
async function createIssue(t: Tenant = A): Promise<string> {
  counter += 1;
  const res = await http()
    .post(`${API}/estates/${t.estateId}/issues`)
    .set(auth(t.token))
    .send({
      type: 'Averia',
      title: `Incidencia de prueba ${counter}`,
      description: `Descripción ${counter} distinta para que no sea un duplicado`,
      priority: 'Normal',
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

const interact = (id: string, body: object, t: Tenant = A) =>
  http()
    .post(`${API}/issues/${id}/interactions`)
    .set(auth(t.token))
    .set('X-Domora-Legacy-Client', 'spec-legacy-client')
    .send({ legacyNoNextStep: true, ...(body as object) });

describe('GET /estates/:id/issues?situation= (filtro por situación)', () => {
  const ids = {
    attention: '',
    waiting: [] as string[],
    resolved: '',
  };
  const list = (query: string, token = A.token, estateId = A.estateId) =>
    http().get(`${API}/estates/${estateId}/issues${query}`).set(auth(token));

  beforeAll(async () => {
    ids.attention = await createIssue();
    await prisma.$transaction((tx) =>
      workflow.openTask(tx, {
        issueId: ids.attention,
        kind: 'review_issue',
        payload: { reason: 'manual_review' },
        discriminator: `filtro-${randomUUID()}`,
      }),
    );
    for (let i = 0; i < 3; i++) {
      const id = await createIssue();
      const res = await interact(id, {
        channel: 'phone',
        direction: 'outbound',
        party: 'owner',
        partyLabel: 'La propietaria',
        summary: 'Llamo a la propietaria',
        effects: [{ type: 'start_wait', kind: 'owner_reply', dueInHours: 48 }],
      });
      expect(res.status).toBe(201);
      ids.waiting.push(id);
    }
    ids.resolved = await createIssue();
    const status = await http()
      .patch(`${API}/issues/${ids.resolved}/status`)
      .set(auth(A.token))
      .send({ status: 'Resuelta' });
    expect(status.status).toBe(200);
    // Otra finca con sus propias incidencias: nunca debe aparecer aquí.
    const foreign = await createIssue(B);
    await prisma.$transaction((tx) =>
      workflow.openTask(tx, {
        issueId: foreign,
        kind: 'review_issue',
        payload: { reason: 'manual_review' },
        discriminator: `filtro-${randomUUID()}`,
      }),
    );
  });

  it('sin filtro responde exactamente como siempre: todas las incidencias de la finca, paginadas', async () => {
    const res = await list('');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'items',
      'page',
      'pageSize',
      'total',
    ]);
    expect(res.body.total).toBe(5);
    expect(res.body.items.map((i: any) => i.id).sort()).toEqual(
      [ids.attention, ...ids.waiting, ids.resolved].sort(),
    );
  });

  it('cada filtro devuelve solo las incidencias de su agrupación, con la misma forma que el listado normal', async () => {
    const byFilter = {
      attention: [ids.attention],
      waiting: ids.waiting,
      resolved: [ids.resolved],
    } as const;
    for (const key of ISSUE_SITUATION_FILTER_KEYS) {
      const res = await list(`?situation=${key}`);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'items',
        'page',
        'pageSize',
        'total',
      ]);
      expect(res.body.items.map((i: any) => i.id).sort()).toEqual(
        [...byFilter[key]].sort(),
      );
      expect(res.body.total).toBe(byFilter[key].length);
      // Cada incidencia del filtro tiene la misma forma que en el listado normal (fotos, historial…).
      for (const item of res.body.items) {
        expect(item).toHaveProperty('photos');
        expect(item).toHaveProperty('timeline');
      }
    }
  });

  it('el filtro y la situación del detalle son la misma proyección: una incidencia está en el filtro de su situación', async () => {
    for (const key of ISSUE_SITUATION_FILTER_KEYS) {
      const res = await list(`?situation=${key}`);
      for (const item of res.body.items) {
        const situation = await http()
          .get(`${API}/issues/${item.id}/situation`)
          .set(auth(A.token));
        expect(ISSUE_SITUATION_FILTERS[key] as readonly string[]).toContain(
          situation.body.situation,
        );
      }
    }
  });

  it('el resumen cuenta los mismos grupos que el filtro (sin duplicar el mapeo)', async () => {
    const summary = await http()
      .get(`${API}/estates/${A.estateId}/issues/situation-summary`)
      .set(auth(A.token));
    expect(summary.body.filters).toEqual({
      attention: 1,
      waiting: 3,
      resolved: 1,
    });
    for (const key of ISSUE_SITUATION_FILTER_KEYS) {
      const res = await list(`?situation=${key}`);
      expect(res.body.total).toBe(summary.body.filters[key]);
    }
  });

  it('la paginación se hace sobre el resultado filtrado', async () => {
    const first = await list('?situation=waiting&page=1&pageSize=2');
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(first.body.items).toHaveLength(2);
    const second = await list('?situation=waiting&page=2&pageSize=2');
    expect(second.body.items).toHaveLength(1);
    const seen = [...first.body.items, ...second.body.items]
      .map((i: any) => i.id)
      .sort();
    expect(seen).toEqual([...ids.waiting].sort());
  });

  it('se combina con el filtro por instalación y no filtra nada de otra finca', async () => {
    const res = await list('?situation=attention');
    expect(res.body.items.map((i: any) => i.id)).toEqual([ids.attention]);
    const other = await list('?situation=attention', B.token, B.estateId);
    expect(other.body.total).toBe(1);
    expect(other.body.items.some((i: any) => i.id === ids.attention)).toBe(
      false,
    );
  });

  it('un valor desconocido es 400; el propietario no puede filtrar por una proyección de gestión; otra gestora no entra', async () => {
    expect((await list('?situation=urgentes')).status).toBe(400);
    expect((await list('?situation=')).status).toBe(400);
    expect((await list('?situation=attention', ownerToken)).status).toBe(400);
    expect(
      (await list('?situation=attention', B.token, A.estateId)).status,
    ).toBe(403);
    expect(
      (
        await http().get(
          `${API}/estates/${A.estateId}/issues?situation=attention`,
        )
      ).status,
    ).toBe(401);
  });

  it('al cambiar la situación de una incidencia cambia de filtro', async () => {
    const id = await createIssue();
    expect(
      (await list('?situation=resolved')).body.items.map((i: any) => i.id),
    ).not.toContain(id);
    await http()
      .patch(`${API}/issues/${id}/status`)
      .set(auth(A.token))
      .send({ status: 'Resuelta' });
    expect(
      (await list('?situation=resolved')).body.items.map((i: any) => i.id),
    ).toContain(id);
  });
});

describe('POST /issues/:id/requester-notices/preview (texto exacto antes de informar)', () => {
  let issueId: string;
  const preview = (id: string, body: object, token = A.token) =>
    http()
      .post(`${API}/issues/${id}/requester-notices/preview`)
      .set(auth(token))
      .send(body);
  const futureVisit = new Date(Date.now() + 3 * 86_400_000).toISOString();

  beforeAll(async () => {
    issueId = await createIssue();
    await prisma.issueReport.updateMany({
      where: { issueId },
      data: { reporterUserId: ownerId },
    });
  });

  it('devuelve el texto que renderiza el servidor, igual que el envío real, para cada plantilla', async () => {
    const cases = [
      { template: 'visit_scheduled', when: futureVisit },
      { template: 'third_party_contacted', label: 'Ascensores Levante' },
      { template: 'waiting_third_party', label: 'Mapfre' },
      { template: 'issue_resolved' },
    ] as const;
    for (const c of cases) {
      const res = await preview(issueId, c);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        renderRequesterMessage(c.template, {
          when: 'when' in c ? c.when : undefined,
          label: 'label' in c ? c.label : undefined,
        }),
      );
    }
  });

  it('NO envía ni registra nada: ni eventos, ni notificaciones', async () => {
    const before = {
      events: await prisma.issueTimelineEntry.count({ where: { issueId } }),
      notifications: await prisma.notification.count({
        where: { userId: ownerId },
      }),
    };
    expect(
      (await preview(issueId, { template: 'issue_resolved' })).status,
    ).toBe(200);
    expect(await prisma.issueTimelineEntry.count({ where: { issueId } })).toBe(
      before.events,
    );
    expect(
      await prisma.notification.count({ where: { userId: ownerId } }),
    ).toBe(before.notifications);
  });

  it('confirmar envía exactamente lo que se vio: el evento del historial lleva el mismo texto', async () => {
    const params = {
      template: 'third_party_contacted',
      label: 'Fontanería Martín',
    };
    const seen = (await preview(issueId, params)).body;
    const sent = await interact(issueId, {
      channel: 'other',
      direction: 'outbound',
      party: 'requester',
      summary: 'Aviso al solicitante',
      effects: [{ type: 'inform_requester', ...params }],
    });
    expect(sent.status).toBe(201);
    const event = await prisma.issueTimelineEntry.findFirstOrThrow({
      where: { issueId, kind: 'requester_informed' },
      orderBy: { date: 'desc' },
    });
    expect(event.text).toBe(seen.body);
  });

  it('sin una persona con cuenta a quien avisar: 409 (igual que el envío)', async () => {
    const noReporter = await createIssue();
    await prisma.issueReport.updateMany({
      where: { issueId: noReporter },
      data: { reporterUserId: null },
    });
    expect(
      (await preview(noReporter, { template: 'issue_resolved' })).status,
    ).toBe(409);
  });

  it('faltan datos → 400; plantilla desconocida o campos de más → 400', async () => {
    expect(
      (await preview(issueId, { template: 'third_party_contacted' })).status,
    ).toBe(400);
    expect(
      (await preview(issueId, { template: 'visit_scheduled' })).status,
    ).toBe(400);
    expect((await preview(issueId, { template: 'inventada' })).status).toBe(
      400,
    );
    expect(
      (await preview(issueId, { template: 'issue_resolved', extra: 1 })).status,
    ).toBe(400);
    expect(
      (await preview('no-es-uuid', { template: 'issue_resolved' })).status,
    ).toBe(400);
  });

  it('solo la gestión de esa incidencia: sin sesión 401, propietario 403, otra gestora 403', async () => {
    expect(
      (
        await http()
          .post(`${API}/issues/${issueId}/requester-notices/preview`)
          .send({ template: 'issue_resolved' })
      ).status,
    ).toBe(401);
    expect(
      (await preview(issueId, { template: 'issue_resolved' }, ownerToken))
        .status,
    ).toBe(403);
    expect(
      (await preview(issueId, { template: 'issue_resolved' }, B.token)).status,
    ).toBe(403);
  });
});
