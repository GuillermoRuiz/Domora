/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  createProperty,
  purgeAdministrator,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * La agenda a través de HTTP, con la aplicación COMPLETA (guards globales de
 * JWT, roles, suscripción y límite de peticiones; ValidationPipe como en
 * main.ts) y PostgreSQL real. Aquí se comprueba lo que los tests de servicio
 * no pueden: que cada ruta exige sesión y rol B, que la validación de los DTO
 * rechaza lo que debe, que la suscripción vencida impide escribir y que el
 * JSON que sale del backend tiene EXACTAMENTE la forma que declara el modelo
 * TypeScript del frontend.
 */
jest.setTimeout(120_000);

const prisma = createPrismaClient();
let app: INestApplication<App>;
let jwt: JwtService;
const API = '/api/v1/agenda';

interface Tenant {
  administratorId: string;
  userId: string;
  estateId: string;
  issueId: string;
  token: string;
}
let A: Tenant;
let B: Tenant;

function sign(
  role: AppRole,
  userId: string,
  administratorId: string | null,
  estateIds: string[],
): string {
  return jwt.sign({ sub: userId, role, estateIds, administratorId });
}

async function tenant(name: string): Promise<Tenant> {
  const admin = await createAdministrator(prisma, { name });
  const estateId = await createEstate(prisma, admin.administratorId, {
    name: `${name} · finca`,
  });
  await createProperty(prisma, estateId);
  const issue = await prisma.issue.create({
    data: {
      ref: `INC-${randomUUID().slice(0, 8)}`,
      estateId,
      type: 'Averia',
      title: 'Avería ascensor',
      description: 'x',
      status: 'Abierta',
      priority: 'Normal',
      source: 'Comunidad',
      date: new Date(),
    },
  });
  return {
    administratorId: admin.administratorId,
    userId: admin.userId,
    estateId,
    issueId: issue.id,
    token: sign('B', admin.userId, admin.administratorId, [estateId]),
  };
}

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const WEEK =
  'from=2026-10-11T22:00:00.000Z&to=2026-10-18T22:00:00.000Z&tz=Europe/Madrid';
const body = (extra: Record<string, unknown> = {}) => ({
  title: 'Llamar al proveedor del ascensor',
  startAt: '2026-10-14T07:00:00.000Z',
  endAt: '2026-10-14T08:00:00.000Z',
  ...extra,
});

/** Claves declaradas por una interfaz del modelo TypeScript del FRONTEND (fuente de verdad del contrato). */
function frontendKeys(interfaceName: string): string[] {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../src/app/core/agenda-tasks.model.ts'),
    'utf-8',
  );
  const match = new RegExp(
    `export interface ${interfaceName}(?:\\s+extends\\s+(\\w+))?\\s*\\{([\\s\\S]*?)\\n\\}`,
  ).exec(source);
  if (!match)
    throw new Error(
      `No se encontró la interfaz ${interfaceName} en el modelo del frontend`,
    );
  const own = [...match[2].matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
  return [...(match[1] ? frontendKeys(match[1]) : []), ...own].sort();
}

beforeAll(async () => {
  // Solo se fija `Date` (2026-10-14 12:00Z): ningún test depende de cuándo se ejecuta.
  jest.useFakeTimers({
    now: new Date('2026-10-14T12:00:00.000Z'),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  // Idéntico a main.ts.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  // Con el servidor ya escuchando, varias peticiones de supertest a la vez comparten el mismo puerto.
  await app.listen(0);
  jwt = moduleRef.get(JwtService);
  A = await tenant('HTTP Gestora A');
  B = await tenant('HTTP Gestora B');
});

afterAll(async () => {
  jest.useRealTimers();
  for (const t of [A, B]) {
    await prisma.agendaTask.deleteMany({
      where: { administratorId: t.administratorId },
    });
    await prisma.issue.deleteMany({
      where: { estateId: t.estateId },
    });
    await purgeAdministrator(prisma, t.administratorId);
  }
  await app.close();
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.agendaTask.deleteMany({
    where: { administratorId: { in: [A.administratorId, B.administratorId] } },
  });
});

const create = async (t: Tenant = A, extra: Record<string, unknown> = {}) => {
  const res = await request(app.getHttpServer())
    .post(`${API}/tasks`)
    .set(auth(t.token))
    .send(body(extra));
  expect(res.status).toBe(201);
  return res.body as { id: string };
};

describe('autenticación y rol: ninguna ruta de la agenda es accesible sin sesión de gestor', () => {
  const some = randomUUID();
  const routes: [string, string][] = [
    ['get', `/tasks?${WEEK}`],
    ['get', '/tasks/summary?dayFrom=a&dayTo=b&weekFrom=c&weekTo=d'],
    ['get', `/tasks/${some}`],
    ['post', '/tasks'],
    ['patch', `/tasks/${some}`],
    ['patch', `/tasks/${some}/status`],
    ['post', `/tasks/${some}/duplicate`],
    ['delete', `/tasks/${some}`],
    ['post', `/tasks/${some}/comments`],
    ['delete', `/tasks/${some}/comments/${some}`],
    ['post', `/tasks/${some}/checklist`],
    ['patch', `/tasks/${some}/checklist/${some}`],
    ['delete', `/tasks/${some}/checklist/${some}`],
    ['post', `/tasks/${some}/attachments`],
    ['get', `/tasks/${some}/attachments/${some}/file`],
    ['delete', `/tasks/${some}/attachments/${some}`],
    ['get', '/labels'],
    ['post', '/labels'],
    ['delete', `/labels/${some}`],
    ['get', '/assignees'],
  ];

  it.each(routes)('%s %s → 401 sin token', async (method, url) => {
    const res = await (request(app.getHttpServer()) as any)
      [method](`${API}${url}`)
      .send({});
    expect(res.status).toBe(401);
  });

  it.each(routes)(
    '%s %s → 403 para propietarios (C) y para soporte (A)',
    async (method, url) => {
      for (const role of ['C', 'A'] as const) {
        const token = sign(role, randomUUID(), null, []);
        const res = await (request(app.getHttpServer()) as any)
          [method](`${API}${url}`)
          .set(auth(token))
          .send({});
        expect({ role, status: res.status }).toEqual({ role, status: 403 });
      }
    },
  );

  it('un gestor sin gestora asociada recibe 403', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/tasks?${WEEK}`)
      .set(auth(sign('B', randomUUID(), null, [])));
    expect(res.status).toBe(403);
  });

  it('un token manipulado o caducado se rechaza', async () => {
    const forged = A.token.slice(0, -4) + 'abcd';
    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/labels`)
          .set(auth(forged))
      ).status,
    ).toBe(401);
    const expired = jwt.sign(
      {
        sub: A.userId,
        role: 'B',
        estateIds: [],
        administratorId: A.administratorId,
      },
      { expiresIn: -10 },
    );
    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/labels`)
          .set(auth(expired))
      ).status,
    ).toBe(401);
  });
});

describe('suscripción: el estado de la gestora se respeta también en la agenda', () => {
  afterEach(() =>
    prisma.administrator.update({
      where: { id: A.administratorId },
      data: { status: 'Activa' },
    }),
  );

  it('con la suscripción VENCIDA se puede consultar pero no escribir', async () => {
    const task = await create();
    await prisma.administrator.update({
      where: { id: A.administratorId },
      data: { status: 'Vencida' },
    });

    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/tasks?${WEEK}`)
          .set(auth(A.token))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/tasks/${task.id}`)
          .set(auth(A.token))
      ).status,
    ).toBe(200);
    for (const attempt of [
      request(app.getHttpServer())
        .post(`${API}/tasks`)
        .set(auth(A.token))
        .send(body()),
      request(app.getHttpServer())
        .patch(`${API}/tasks/${task.id}`)
        .set(auth(A.token))
        .send({ title: 'x' }),
      request(app.getHttpServer())
        .delete(`${API}/tasks/${task.id}`)
        .set(auth(A.token)),
      request(app.getHttpServer())
        .post(`${API}/tasks/${task.id}/comments`)
        .set(auth(A.token))
        .send({ text: 'x' }),
    ]) {
      expect((await attempt).status).toBe(403);
    }
  });

  it('con la cuenta BLOQUEADA no se puede ni consultar', async () => {
    await prisma.administrator.update({
      where: { id: A.administratorId },
      data: { status: 'Bloqueada' },
    });
    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/tasks?${WEEK}`)
          .set(auth(A.token))
      ).status,
    ).toBe(403);
  });
});

describe('validación de entrada (ValidationPipe estricto)', () => {
  const post = (data: unknown) =>
    request(app.getHttpServer())
      .post(`${API}/tasks`)
      .set(auth(A.token))
      .send(data as object);

  it.each([
    ['sin título', { ...body(), title: undefined }],
    ['título vacío', body({ title: '' })],
    ['título de 201 caracteres', body({ title: 'x'.repeat(201) })],
    ['campo desconocido', body({ administratorId: randomUUID() })],
    ['autor inyectado', body({ createdByUserId: randomUUID() })],
    ['prioridad inválida', body({ priority: 'CRITICA' })],
    ['tipo inválido', body({ type: 'INVENTADO' })],
    ['estado inválido', body({ status: 'HECHA' })],
    ['fecha inválida', body({ startAt: 'ayer' })],
    ['recordatorio negativo', body({ reminderMinutesBefore: -1 })],
    ['recordatorio > 7 días', body({ reminderMinutesBefore: 10_081 })],
    [
      'recurrencia con intervalo 0',
      body({ recurrence: { freq: 'DAILY', interval: 0 } }),
    ],
    [
      'recurrencia con frecuencia inválida',
      body({ recurrence: { freq: 'HOURLY', interval: 1 } }),
    ],
    ['etiqueta que no es uuid', body({ labelIds: ['abc'] })],
    [
      'vínculo con tipo inválido',
      body({ links: [{ type: 'invoice', id: randomUUID() }] }),
    ],
    ['checklist con texto vacío', body({ checklist: [''] })],
  ])('POST /tasks rechaza: %s (400) y no crea nada', async (_name, data) => {
    const res = await post(data);
    expect(res.status).toBe(400);
    expect(
      await prisma.agendaTask.count({
        where: { administratorId: A.administratorId },
      }),
    ).toBe(0);
  });

  it('PATCH distingue "null" (borrar) de "ausente" (no tocar) y valida tipos', async () => {
    const task = await create(A, { description: 'texto' });
    const patch = (data: object) =>
      request(app.getHttpServer())
        .patch(`${API}/tasks/${task.id}`)
        .set(auth(A.token))
        .send(data);

    expect((await patch({ description: null })).body.description).toBeNull();
    expect((await patch({ title: 'Nuevo título' })).body.title).toBe(
      'Nuevo título',
    );
    expect((await patch({ priority: 'URGENTE' })).body.priority).toBe(
      'URGENTE',
    );
    expect((await patch({ priority: 'XXX' })).status).toBe(400);
    expect((await patch({ id: randomUUID() })).status).toBe(400);
    expect((await patch({ assignedToUserId: 'no-uuid' })).status).toBe(400);
  });

  it('las consultas validan sus parámetros', async () => {
    const get = (qs: string) =>
      request(app.getHttpServer()).get(`${API}/tasks?${qs}`).set(auth(A.token));
    expect((await get('from=2026-10-11T22:00:00.000Z')).status).toBe(400); // falta "to"
    expect((await get('from=a&to=b')).status).toBe(400);
    expect((await get(`${WEEK}&priority=URGENTE,INVENTADA`)).status).toBe(400);
    expect((await get(`${WEEK}&labelIds=nope`)).status).toBe(400);
    expect((await get(`${WEEK}&tz=Marte/Olimpo`)).status).toBe(400);
    expect((await get('overdue=true&limit=201')).status).toBe(400);
    expect((await get('overdue=maybe')).status).toBe(400);
    expect(
      (await get('from=2026-01-01T00:00:00.000Z&to=2027-06-01T00:00:00.000Z'))
        .status,
    ).toBe(400); // > 100 días
    expect((await get(`${WEEK}&injected=1`)).status).toBe(400);
    expect((await get(WEEK)).status).toBe(200);
  });

  it('un id que no es UUID responde 404, no 500', async () => {
    const res = await request(app.getHttpServer())
      .get(`${API}/tasks/no-es-un-uuid`)
      .set(auth(A.token));
    expect(res.status).toBe(404);
  });
});

describe('aislamiento entre gestoras a través de HTTP', () => {
  it('el token de la gestora B recibe 404 en TODAS las rutas sobre una tarea de A, y la tarea queda intacta', async () => {
    const task = await create(A, { checklist: ['uno'], estateId: A.estateId });
    const comment = (
      await request(app.getHttpServer())
        .post(`${API}/tasks/${task.id}/comments`)
        .set(auth(A.token))
        .send({ text: 'nota' })
    ).body;
    const attachment = (
      await request(app.getHttpServer())
        .post(`${API}/tasks/${task.id}/attachments`)
        .set(auth(A.token))
        .attach('file', Buffer.from('%PDF-1.4'), {
          filename: 'a.pdf',
          contentType: 'application/pdf',
        })
    ).body;
    const detail = (
      await request(app.getHttpServer())
        .get(`${API}/tasks/${task.id}`)
        .set(auth(A.token))
    ).body;
    const itemId = detail.checklist[0].id;
    const b = (t: 'get' | 'post' | 'patch' | 'delete', url: string) =>
      (request(app.getHttpServer()) as any)
        [t](`${API}${url}`)
        .set(auth(B.token));

    const attempts = [
      b('get', `/tasks/${task.id}`),
      b('patch', `/tasks/${task.id}`).send({ title: 'x' }),
      b('patch', `/tasks/${task.id}/status`).send({ status: 'COMPLETADA' }),
      b('post', `/tasks/${task.id}/duplicate`).send({}),
      b('delete', `/tasks/${task.id}`),
      b('post', `/tasks/${task.id}/comments`).send({ text: 'x' }),
      b('delete', `/tasks/${task.id}/comments/${comment.id}`),
      b('post', `/tasks/${task.id}/checklist`).send({ text: 'x' }),
      b('patch', `/tasks/${task.id}/checklist/${itemId}`).send({ done: true }),
      b('delete', `/tasks/${task.id}/checklist/${itemId}`),
      b('post', `/tasks/${task.id}/attachments`).attach(
        'file',
        Buffer.from('x'),
        { filename: 'b.pdf', contentType: 'application/pdf' },
      ),
      b('get', `/tasks/${task.id}/attachments/${attachment.id}/file`),
      b('delete', `/tasks/${task.id}/attachments/${attachment.id}`),
    ];
    for (const res of await Promise.all(attempts)) expect(res.status).toBe(404);

    const after = (
      await request(app.getHttpServer())
        .get(`${API}/tasks/${task.id}`)
        .set(auth(A.token))
    ).body;
    expect(after.title).toBe(detail.title);
    expect(after.status).toBe('PENDIENTE');
    expect(after.comments).toHaveLength(1);
    expect(after.attachments).toHaveLength(1);
    expect(after.checklist[0].done).toBe(false);
  });

  it('B no ve nada de A en listas ni resumen, y no puede apuntar a recursos de A al crear', async () => {
    const task = await create(A, { estateId: A.estateId, priority: 'URGENTE' });
    const labelA = (
      await request(app.getHttpServer()).get(`${API}/labels`).set(auth(A.token))
    ).body[0];

    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/tasks?${WEEK}`)
          .set(auth(B.token))
      ).body,
    ).toEqual([]);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/tasks?priority=URGENTE`)
          .set(auth(B.token))
      ).body,
    ).toEqual([]);
    const forbiddenEstate = await request(app.getHttpServer())
      .post(`${API}/tasks`)
      .set(auth(B.token))
      .send(body({ estateId: A.estateId }));
    const foreignAssignee = await request(app.getHttpServer())
      .post(`${API}/tasks`)
      .set(auth(B.token))
      .send(body({ assignedToUserId: A.userId }));
    const foreignLabel = await request(app.getHttpServer())
      .post(`${API}/tasks`)
      .set(auth(B.token))
      .send(body({ labelIds: [labelA.id] }));
    const foreignIssue = await request(app.getHttpServer())
      .post(`${API}/tasks`)
      .set(auth(B.token))
      .send(body({ links: [{ type: 'issue', id: A.issueId }] }));
    expect([
      forbiddenEstate.status,
      foreignAssignee.status,
      foreignLabel.status,
      foreignIssue.status,
    ]).toEqual([403, 400, 400, 400]);
    expect(task.id).toBeTruthy();
  });
});

describe('flujo completo por HTTP y contrato con el modelo TypeScript del frontend', () => {
  it('crear → listar → editar → estado → duplicar → comentar → checklist → adjuntar → descargar → borrar', async () => {
    const http = () => request(app.getHttpServer());
    const label = (
      await http()
        .post(`${API}/labels`)
        .set(auth(A.token))
        .send({ name: 'Prueba HTTP' })
    ).body;

    const created = await http()
      .post(`${API}/tasks`)
      .set(auth(A.token))
      .send(
        body({
          startAt: '2026-10-14T15:00:00.000Z',
          endAt: '2026-10-14T16:00:00.000Z',
          estateId: A.estateId,
          assignedToUserId: A.userId,
          type: 'LLAMADA',
          priority: 'ALTA',
          labelIds: [label.id],
          checklist: ['Revisar histórico'],
          links: [{ type: 'issue', id: A.issueId }],
          reminderMinutesBefore: 30,
        }),
      );
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const list = await http().get(`${API}/tasks?${WEEK}`).set(auth(A.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      id,
      title: 'Llamar al proveedor del ascensor',
      type: 'LLAMADA',
      priority: 'ALTA',
      status: 'PENDIENTE',
      overdue: false,
      recurring: false,
    });

    // Contrato: las claves del JSON son EXACTAMENTE las del modelo TypeScript del frontend.
    expect(Object.keys(list.body[0]).sort()).toEqual(
      frontendKeys('AgendaTask'),
    );
    expect(Object.keys(created.body).sort()).toEqual(
      frontendKeys('AgendaTaskDetail'),
    );
    expect(Object.keys(created.body.links[0]).sort()).toEqual(
      frontendKeys('LinkedEntity'),
    );
    expect(Object.keys(created.body.checklist[0]).sort()).toEqual(
      frontendKeys('ChecklistItem'),
    );
    expect(Object.keys(created.body.assignee).sort()).toEqual(
      frontendKeys('PersonRef'),
    );
    expect(Object.keys(created.body.labels[0]).sort()).toEqual(
      frontendKeys('TaskLabel'),
    );

    const summary = await http()
      .get(
        `${API}/tasks/summary?dayFrom=2026-10-13T22:00:00.000Z&dayTo=2026-10-14T22:00:00.000Z&weekFrom=2026-10-11T22:00:00.000Z&weekTo=2026-10-18T22:00:00.000Z&tz=Europe/Madrid`,
      )
      .set(auth(A.token));
    // El frontend ya no consume el resumen (se retiraron las tarjetas KPI): se mantiene el contrato de la API.
    expect(Object.keys(summary.body).sort()).toEqual([
      'overdue',
      'today',
      'urgent',
      'week',
    ]);

    const comment = await http()
      .post(`${API}/tasks/${id}/comments`)
      .set(auth(A.token))
      .send({ text: 'He preparado el histórico' });
    expect(comment.status).toBe(201);
    expect(Object.keys(comment.body).sort()).toEqual(
      frontendKeys('TaskComment'),
    );

    const item = await http()
      .post(`${API}/tasks/${id}/checklist`)
      .set(auth(A.token))
      .send({ text: 'Llamar' });
    expect(Object.keys(item.body).sort()).toEqual(
      frontendKeys('ChecklistItem'),
    );
    expect(
      (
        await http()
          .patch(`${API}/tasks/${id}/checklist/${item.body.id}`)
          .set(auth(A.token))
          .send({ done: true })
      ).body.done,
    ).toBe(true);

    const upload = await http()
      .post(`${API}/tasks/${id}/attachments`)
      .set(auth(A.token))
      .attach('file', Buffer.from('%PDF-1.4 contenido'), {
        filename: 'presupuesto.pdf',
        contentType: 'application/pdf',
      });
    expect(upload.status).toBe(201);
    expect(Object.keys(upload.body).sort()).toEqual(
      frontendKeys('TaskAttachment'),
    );
    const download = await http()
      .get(`${API}/tasks/${id}/attachments/${upload.body.id}/file`)
      .set(auth(A.token));
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain(
      'application/octet-stream',
    ); // nunca se sirve "inline"
    expect(download.headers['content-disposition']).toMatch(/^attachment;/);
    expect(download.body.toString()).toBe('%PDF-1.4 contenido');

    // Completar exige la checklist terminada (la regla vive en el servicio): se termina la que quede.
    await prisma.agendaTaskChecklistItem.updateMany({
      where: { taskId: id },
      data: { done: true },
    });
    const status = await http()
      .patch(`${API}/tasks/${id}/status`)
      .set(auth(A.token))
      .send({ status: 'COMPLETADA' });
    expect(status.body.status).toBe('COMPLETADA');
    const copy = await http()
      .post(`${API}/tasks/${id}/duplicate`)
      .set(auth(A.token))
      .send({});
    expect(copy.status).toBe(201);
    expect(copy.body.status).toBe('PENDIENTE');

    expect(
      (
        await http()
          .delete(`${API}/tasks/${id}/attachments/${upload.body.id}`)
          .set(auth(A.token))
      ).status,
    ).toBe(204);
    expect(
      (await http().delete(`${API}/tasks/${id}`).set(auth(A.token))).status,
    ).toBe(204);
    expect(
      (await http().get(`${API}/tasks/${id}`).set(auth(A.token))).status,
    ).toBe(404);
    expect(
      (await http().delete(`${API}/labels/${label.id}`).set(auth(A.token)))
        .status,
    ).toBe(204);
  });

  it('una tarea recurrente expone el contrato de serie y de ocurrencia al frontend', async () => {
    await create(A, {
      timezone: 'UTC',
      startAt: '2026-10-12T09:00:00.000Z',
      endAt: '2026-10-12T10:00:00.000Z',
      recurrence: { freq: 'WEEKLY', interval: 1 },
    });

    const list = await request(app.getHttpServer())
      .get(
        `${API}/tasks?from=2026-10-12T00:00:00.000Z&to=2026-11-02T00:00:00.000Z&tz=UTC`,
      )
      .set(auth(A.token));

    expect(list.body.map((t: any) => t.occurrenceStart)).toEqual([
      '2026-10-12T09:00:00.000Z',
      '2026-10-19T09:00:00.000Z',
      '2026-10-26T09:00:00.000Z',
    ]);
    expect(list.body[0].recurrence).toEqual({
      freq: 'WEEKLY',
      interval: 1,
      until: null,
    });
    expect(list.body[0].recurring).toBe(true);
    expect(Object.keys(list.body[0].recurrence).sort()).toEqual([
      'freq',
      'interval',
      'until',
    ]);
  });

  it('la cabecera X-Agenda-Truncated solo aparece cuando la respuesta se recortó por el tope de seguridad', async () => {
    const week = `${API}/tasks?from=2026-10-11T22:00:00.000Z&to=2026-10-18T22:00:00.000Z&tz=Europe/Madrid`;
    await create(A, {});
    const small = await request(app.getHttpServer())
      .get(week)
      .set(auth(A.token));
    expect(small.status).toBe(200);
    expect(small.headers['x-agenda-truncated']).toBeUndefined();

    await prisma.agendaTask.createMany({
      data: Array.from({ length: 1000 }, (_, i) => ({
        administratorId: A.administratorId,
        createdByUserId: A.userId,
        title: `Masiva ${i}`,
        startAt: new Date('2026-10-14T09:00:00.000Z'),
        endAt: new Date('2026-10-14T10:00:00.000Z'),
      })),
    });
    const big = await request(app.getHttpServer()).get(week).set(auth(A.token));
    expect(big.status).toBe(200);
    expect(Array.isArray(big.body)).toBe(true); // el contrato sigue siendo un array
    expect(big.headers['x-agenda-truncated']).toBe('true');
  });

  it('las fechas viajan en ISO-8601 UTC, sin desplazarse', async () => {
    const created = await create(A, {
      startAt: new Date('2026-10-14T09:00:00+02:00').toISOString(),
      endAt: new Date('2026-10-14T10:00:00+02:00').toISOString(),
    });
    const detail = (
      await request(app.getHttpServer())
        .get(`${API}/tasks/${created.id}`)
        .set(auth(A.token))
    ).body;
    expect(detail.startAt).toBe('2026-10-14T07:00:00.000Z');
    expect(detail.occurrenceStart).toBe('2026-10-14T07:00:00.000Z');
    expect(detail.endAt).toBe('2026-10-14T08:00:00.000Z');
  });

  it('adjuntos por HTTP: tipo no permitido (400) y fichero demasiado grande (413)', async () => {
    const task = await create();
    const exe = await request(app.getHttpServer())
      .post(`${API}/tasks/${task.id}/attachments`)
      .set(auth(A.token))
      .attach('file', Buffer.from('MZ'), {
        filename: 'a.exe',
        contentType: 'application/x-msdownload',
      });
    expect(exe.status).toBe(400);
    const big = await request(app.getHttpServer())
      .post(`${API}/tasks/${task.id}/attachments`)
      .set(auth(A.token))
      .attach('file', Buffer.alloc(11 * 1024 * 1024), {
        filename: 'grande.pdf',
        contentType: 'application/pdf',
      });
    expect(big.status).toBe(413);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${API}/tasks/${task.id}`)
          .set(auth(A.token))
      ).body.attachments,
    ).toEqual([]);
  });

  it('el catálogo de etiquetas por HTTP: sembrado único, y lo borrado no reaparece', async () => {
    const http = () => request(app.getHttpServer());
    const first = (await http().get(`${API}/labels`).set(auth(B.token)))
      .body as { id: string; name: string }[];
    expect(first.length).toBe(15);
    expect(
      (await http().delete(`${API}/labels/${first[0].id}`).set(auth(B.token)))
        .status,
    ).toBe(204);
    const second = (await http().get(`${API}/labels`).set(auth(B.token)))
      .body as { id: string }[];
    expect(second.length).toBe(14);
    expect(second.map((l) => l.id)).not.toContain(first[0].id);
  });
});
