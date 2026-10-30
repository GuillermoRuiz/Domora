/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '../prisma/client';
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
  createSupplier,
  linkOwner,
  purgeAdministrator,
} from './db-fixtures';

/**
 * Banco de pruebas mínimo de Incidencias, 100 % manual: la aplicación completa sobre PostgreSQL real, sin cola de IA, sin
 * simuladores y sin proveedor de modelo. Las pruebas hablan HTTP como lo hace la web; el harness solo prepara gestoras, fincas,
 * propietarios y proveedores y limpia lo que creó. No contiene lógica de dominio: si una prueba necesita estado que la API no
 * deja crear (una visita vencida, una espera antigua), lo escribe con `prisma` y lo dice.
 */
export interface Tenant {
  administratorId: string;
  userId: string;
  estateId: string;
  propertyId: string;
  /** Token de la gestión (rol B) de esta gestora. */
  token: string;
}

export interface Owner {
  userId: string;
  token: string;
}

export interface IssueHarness {
  prisma: PrismaClient;
  app: INestApplication<App>;
  api: string;
  http: () => ReturnType<typeof request>;
  auth: (token: string) => { Authorization: string };
  sign: (
    role: AppRole,
    userId: string,
    administratorId: string | null,
    estateIds: string[],
  ) => string;
  /** Gestora con una finca y una propiedad. */
  tenant: (name: string) => Promise<Tenant>;
  /** Propietario (rol C) vinculado a la propiedad del tenant. */
  owner: (t: Tenant, fullName?: string) => Promise<Owner>;
  /** Proveedor del directorio de la finca. */
  supplier: (
    t: Tenant,
    over?: { name?: string; category?: string },
  ) => Promise<string>;
  /** Crea una incidencia por la API como lo hace la gestión; devuelve su id. */
  issue: (t: Tenant, over?: Record<string, unknown>) => Promise<string>;
  /** Crea una incidencia por la API como la crearía el propietario. */
  ownerIssue: (o: Owner, t: Tenant) => Promise<string>;
  /** Registra una interacción (los efectos son el único camino manual a esperas, visitas, siniestros y vías). */
  interact: (
    t: Tenant,
    issueId: string,
    body: Record<string, unknown>,
  ) => ReturnType<ReturnType<typeof request>['post']>;
  /** Fija la vía por la API. */
  route: (
    t: Tenant,
    issueId: string,
    route: string | null,
  ) => ReturnType<ReturnType<typeof request>['put']>;
  status: (
    t: Tenant,
    issueId: string,
    status: string,
  ) => ReturnType<ReturnType<typeof request>['patch']>;
  /** Todo lo que Incidencias pudo dejar de automatización en una finca: debe ser siempre vacío. */
  automationArtifacts: (estateId: string) => Promise<string[]>;
  /** `afterPurge`: limpieza propia de la prueba (p. ej. lotes de IA, que no cuelgan de ninguna finca), antes de desconectar. */
  close: (afterPurge?: () => Promise<void>) => Promise<void>;
}

/** Tipos de tarea y de evento que existían solo para la automatización retirada. */
export const REMOVED_TASK_KINDS = [
  'approve_provider_message',
  'confirm_appointment',
  'review_failed_delivery',
  'review_provider_reply',
  'review_duplicate',
];
export const REMOVED_JOB_KINDS = ['incident', 'send', 'reply', 'issue_wait_due'];

async function created(
  send: () => PromiseLike<{ status: number; body: any }>,
): Promise<string> {
  const res = await send();
  if (res.status !== 201)
    throw new Error(`alta de incidencia ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.id as string;
}

export async function startIssueHarness(): Promise<IssueHarness> {
  const prisma = createPrismaClient();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
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
  const jwt = moduleRef.get(JwtService);
  const api = '/api/v1';
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const sign = (
    role: AppRole,
    userId: string,
    administratorId: string | null,
    estateIds: string[],
  ) => jwt.sign({ sub: userId, role, estateIds, administratorId });

  const tenants: Tenant[] = [];
  const ownerIds: string[] = [];
  let counter = 0;

  const h: IssueHarness = {
    prisma,
    app,
    api,
    http,
    auth,
    sign,
    async tenant(name) {
      const admin = await createAdministrator(prisma, { name });
      const estateId = await createEstate(prisma, admin.administratorId, {
        name: `${name} · finca`,
      });
      const propertyId = await createProperty(prisma, estateId);
      const t: Tenant = {
        administratorId: admin.administratorId,
        userId: admin.userId,
        estateId,
        propertyId,
        token: sign('B', admin.userId, admin.administratorId, [estateId]),
      };
      tenants.push(t);
      return t;
    },
    async owner(t, fullName = 'Propietaria de prueba') {
      const userId = await createOwnerUser(prisma, { fullName });
      await linkOwner(prisma, t.propertyId, userId);
      ownerIds.push(userId);
      return { userId, token: sign('C', userId, null, [t.estateId]) };
    },
    supplier: (t, over = {}) =>
      createSupplier(prisma, t.estateId, t.administratorId, over),
    async issue(t, over = {}) {
      counter += 1;
      const body = {
        type: 'Averia',
        title: `Incidencia manual ${counter}`,
        description: `Descripción ${counter} ${randomUUID()}`,
        priority: 'Normal',
        ...over,
      };
      return created(() =>
        http()
          .post(`${api}/estates/${t.estateId}/issues`)
          .set(auth(t.token))
          .send(body),
      );
    },
    async ownerIssue(o, t) {
      counter += 1;
      const body = {
        estateId: t.estateId,
        type: 'Averia',
        title: `Aviso del propietario ${counter}`,
        description: `Descripción propietario ${counter} ${randomUUID()}`,
        location: 'Portal',
        urgent: false,
      };
      return created(() =>
        http().post(`${api}/me/issues`).set(auth(o.token)).send(body),
      );
    },
    interact: (t, issueId, body) =>
      http()
        .post(`${api}/issues/${issueId}/interactions`)
        .set(auth(t.token))
        .send(body),
    route: (t, issueId, route) =>
      http()
        .put(`${api}/issues/${issueId}/resolution-route`)
        .set(auth(t.token))
        .send({ route }),
    status: (t, issueId, status) =>
      http()
        .patch(`${api}/issues/${issueId}/status`)
        .set(auth(t.token))
        .send({ status }),
    async automationArtifacts(estateId) {
      const found: string[] = [];
      const jobs = await prisma.aiJob.count({
        where: { estateId, kind: { in: REMOVED_JOB_KINDS } },
      });
      if (jobs) found.push(`${jobs} ai_jobs de incidencias`);
      const tasks = await prisma.agendaTask.count({
        where: { estateId, kind: { in: REMOVED_TASK_KINDS } },
      });
      if (tasks) found.push(`${tasks} tareas de automatización`);
      const tables = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('ai_incidents', 'ai_messages', 'automation_rules', 'ai_policies')`;
      for (const t of tables) found.push(`tabla ${t.table_name}`);
      return found;
    },
    async close(afterPurge) {
      try {
        for (const t of tenants) {
          await prisma.agendaTask.deleteMany({
            where: { administratorId: t.administratorId },
          });
          // Todas las fincas de la gestora (algunas pruebas crean más), con lo que la IA compartida dejó colgando de ellas.
          const estateIds = (
            await prisma.estate.findMany({
              where: { administratorId: t.administratorId },
              select: { id: true },
            })
          ).map((e) => e.id);
          const byEstate = { estateId: { in: estateIds } };
          await prisma.aiReconciliationSuggestion.deleteMany({ where: byEstate });
          await prisma.aiInvoiceDocument.deleteMany({ where: byEstate });
          await prisma.aiWeeklySnapshot.deleteMany({ where: byEstate });
          await prisma.aiRequest.deleteMany({ where: byEstate });
          await prisma.aiAudit.deleteMany({ where: byEstate });
          await prisma.aiJob.deleteMany({ where: byEstate });
          await prisma.issue.deleteMany({ where: { estateId: t.estateId } });
          await purgeAdministrator(prisma, t.administratorId);
        }
        if (ownerIds.length)
          await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
        await afterPurge?.();
      } finally {
        // Pase lo que pase con la limpieza, la aplicación y la conexión se cierran: si no, Jest se queda colgado.
        await app.close();
        await prisma.$disconnect();
      }
    },
  };
  return h;
}
