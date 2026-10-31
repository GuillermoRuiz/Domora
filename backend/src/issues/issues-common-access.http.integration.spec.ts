/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { createPrismaClient } from '../prisma/create-prisma-client';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  createSupplier,
  purgeAdministrator,
} from '../testing/db-fixtures';

/**
 * INCIDENCIAS (siempre de la comunidad) · autorización y privacidad (HTTP real, guards reales, PostgreSQL real).
 *
 *  - Una incidencia la ven los miembros ACTIVOS de la comunidad (membresía vinculada y no revocada de una propiedad no dada de baja de ESA
 *    finca, comprobado en la base de datos: un JWT viejo no basta). Una ajena es indistinguible de una inexistente.
 *  - Lo que ven es una proyección de LISTA BLANCA: nada de la gestión (proveedor, siniestro, visitas, avisos, vía, presupuesto…).
 *  - Cualquier miembro puede reportar una; solo quien la reportó añade notas y fotos.
 *  - No existen incidencias de vivienda: ni se crean ni se listan por propiedad.
 */
jest.setTimeout(300_000);

const prisma = createPrismaClient();
const API = '/api/v1';

let app: INestApplication<App>;
let jwt: JwtService;

let adminId: string;
let managerId: string;
let otherAdminId: string;
let otherManagerId: string;
let estateId: string;
let otherEstateId: string;
let propertyA: string;
let propertyB: string;
let propertyGone: string;
let propertyOther: string;
let supplierId: string;
let ownerA: string;
let ownerB: string;
let revoked: string;
let pending: string;
let onDeletedProperty: string;
let selfService: string;
let ownerOther: string;
let platformId: string;
let tokens: Record<string, string>;

let common: string; // reportada por ownerA, con datos internos de gestión
let managerCommon: string; // dada de alta por la gestión
let otherCommon: string; // de otra comunidad

const sign = (
  role: 'A' | 'B' | 'C',
  userId: string,
  administratorId: string | null,
  estateIds: string[],
) => jwt.sign({ sub: userId, role, estateIds, administratorId });
const http = () => request(app.getHttpServer());
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const ghost = () => randomUUID();
const shape = (body: { message?: string; statusCode?: number }) => ({
  statusCode: body.statusCode,
  message: (body.message ?? '').replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
    '<id>',
  ),
});

async function link(
  propertyId: string,
  userId: string,
  status: 'linked' | 'revoked' | 'pending' = 'linked',
) {
  await prisma.propertyMembership.create({
    data: {
      propertyId,
      userId,
      roleType: 'Propietario',
      status,
      linkedAt: new Date(),
      revokedAt: status === 'revoked' ? new Date() : null,
    },
  });
}
const payload = (title: string, extra: object = {}) => ({
  type: 'Averia',
  title,
  description: `Descripción de ${title}`,
  priority: 'Normal',
  ...extra,
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
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
  for (const [, job] of moduleRef
    .get(SchedulerRegistry, { strict: false })
    .getCronJobs())
    job.stop();
  jwt = moduleRef.get(JwtService);

  const admin = await createAdministrator(prisma, { name: 'Comunes acceso' });
  adminId = admin.administratorId;
  managerId = admin.userId;
  estateId = await createEstate(prisma, adminId, { name: 'Comunidad comunes' });
  propertyA = await createProperty(prisma, estateId);
  propertyB = await createProperty(prisma, estateId);
  propertyGone = await createProperty(prisma, estateId, {
    deletedAt: new Date(),
  });
  supplierId = await createSupplier(prisma, estateId, adminId, {
    name: 'Proveedor Secreto S.L.',
  });
  const other = await createAdministrator(prisma, {
    name: 'Otra gestora comunes',
  });
  otherAdminId = other.administratorId;
  otherManagerId = other.userId;
  otherEstateId = await createEstate(prisma, otherAdminId, {
    name: 'Otra comunidad comunes',
  });
  propertyOther = await createProperty(prisma, otherEstateId);

  ownerA = await createOwnerUser(prisma, { fullName: 'Propietaria Alba' });
  ownerB = await createOwnerUser(prisma, { fullName: 'Propietario Beltrán' });
  revoked = await createOwnerUser(prisma, { fullName: 'Revocado' });
  pending = await createOwnerUser(prisma, { fullName: 'Pendiente' });
  onDeletedProperty = await createOwnerUser(prisma, {
    fullName: 'De propiedad borrada',
  });
  selfService = await createOwnerUser(prisma, { fullName: 'Autoservicio' });
  ownerOther = await createOwnerUser(prisma, { fullName: 'De otra comunidad' });
  await link(propertyA, ownerA);
  await link(propertyB, ownerB);
  await link(propertyA, revoked, 'revoked');
  await link(propertyA, pending, 'pending');
  await link(propertyGone, onDeletedProperty);
  await link(propertyOther, ownerOther);
  const platform = await prisma.user.create({
    data: {
      email: `plataforma-${randomUUID()}@test.local`,
      passwordHash: 'x',
      fullName: 'Plataforma',
      role: 'A',
    },
  });
  platformId = platform.id;

  // El JWT lleva la finca aunque la membresía ya no valga (así es un JWT «viejo»).
  tokens = {
    manager: sign('B', managerId, adminId, [estateId]),
    otherManager: sign('B', otherManagerId, otherAdminId, [otherEstateId]),
    platform: sign('A', platformId, null, []),
    ownerA: sign('C', ownerA, null, [estateId]),
    ownerB: sign('C', ownerB, null, [estateId]),
    revoked: sign('C', revoked, null, [estateId]),
    pending: sign('C', pending, null, [estateId]),
    onDeletedProperty: sign('C', onDeletedProperty, null, [estateId]),
    selfService: sign('C', selfService, null, [estateId]),
    ownerOther: sign('C', ownerOther, null, [otherEstateId]),
  };

  const created = await http()
    .post(`${API}/estates/${estateId}/issues`)
    .set(auth(tokens.ownerA))
    .send(payload('Ascensor averiado'));
  expect(created.status).toBe(201);
  common = created.body.id;
  const byManager = await http()
    .post(`${API}/estates/${estateId}/issues`)
    .set(auth(tokens.manager))
    .send(payload('Puerta del garaje'));
  expect(byManager.status).toBe(201);
  managerCommon = byManager.body.id;
  const foreign = await http()
    .post(`${API}/estates/${otherEstateId}/issues`)
    .set(auth(tokens.otherManager))
    .send(payload('Ascensor de otra comunidad'));
  expect(foreign.status).toBe(201);
  otherCommon = foreign.body.id;

  // Datos de GESTIÓN de la común: nada de esto puede llegar a un vecino.
  const asset = await prisma.asset.create({
    data: { estateId, name: 'Ascensor interno', category: 'Ascensores' },
  });
  await prisma.issue.update({
    where: { id: common },
    data: {
      assetId: asset.id,
      budgetAmount: '4321.00',
      budgetDescription: 'Presupuesto secreto',
      ownerName: 'Nombre interno',
      resolutionRoute: 'community_insurance',
    },
  });
  await prisma.issueProviderAssignment.create({
    data: {
      issueId: common,
      supplierId,
      providerNameSnapshot: 'Proveedor Secreto S.L.',
      assignedAt: new Date(),
      assignedByUserId: managerId,
    },
  });
  await prisma.insuranceClaim.create({
    data: {
      issueId: common,
      insurerName: 'Aseguradora Secreta',
      reference: 'SIN-SECRETO-1',
      openedAt: new Date(),
    },
  });
  await prisma.issueNotification.create({
    data: {
      issueId: common,
      sentAt: new Date(),
      recipientsCount: 3,
      channel: 'email',
      sentByUserId: managerId,
      subject: 'Aviso interno secreto',
    },
  });
  await prisma.supplierVisit.create({
    data: {
      supplierId,
      estateId,
      issueId: common,
      scheduledAt: new Date(Date.now() + 86_400_000),
      purpose: 'Visita secreta',
    },
  });
  for (const [kind, internal, text] of [
    ['claim_opened', false, 'Siniestro abierto con la Aseguradora Secreta'],
    ['provider_assigned', false, 'Proveedor asignado: Proveedor Secreto S.L.'],
    ['route_decided', false, 'Vía decidida: seguro de la comunidad'],
    ['budget_updated', false, 'Presupuesto actualizado: 4321 €.'],
    ['asset_linked', false, 'Instalación vinculada: Ascensor interno.'],
    ['note', true, 'Nota interna de la gestión'],
  ] as const)
    await prisma.issueTimelineEntry.create({
      data: {
        issueId: common,
        date: new Date(),
        role: 'Administrador',
        actorKind: 'person',
        authorUserId: managerId,
        kind,
        internal,
        text,
        meta: { secreto: 'meta interna' },
        refType: 'ai_message',
        refId: randomUUID(),
      },
    });
  await prisma.issueTimelineEntry.create({
    data: {
      issueId: common,
      date: new Date(),
      role: 'Administrador',
      actorKind: 'person',
      authorUserId: managerId,
      kind: 'note',
      text: 'Nota pública de la administración',
    },
  });
});
afterAll(async () => {
  await prisma.supplierVisit.deleteMany({ where: { estateId } });
  await prisma.issue.deleteMany({
    where: { estateId: { in: [estateId, otherEstateId] } },
  });
  await purgeAdministrator(prisma, adminId, [
    ownerA,
    ownerB,
    revoked,
    pending,
    onDeletedProperty,
    selfService,
  ]).catch(() => undefined);
  await purgeAdministrator(prisma, otherAdminId, [ownerOther]).catch(
    () => undefined,
  );
  await prisma.user.deleteMany({ where: { id: platformId } });
  await app.close();
  await prisma.$disconnect();
});

const FORBIDDEN_KEYS = [
  'providerAssignments',
  'notifications',
  'resolutionRoute',
  'assetId',
  'asset',
  'budgetAmount',
  'budgetDescription',
  'budgetApproved',
  'ownerName',
  'reports',
  's3Key',
  'authorUserId',
  'onBehalfOfUserId',
  'actorKind',
  'meta',
  'refType',
  'refId',
  'internal',
  'deletedAt',
];
const FORBIDDEN_TEXT = [
  'Proveedor Secreto',
  'Aseguradora Secreta',
  'SIN-SECRETO',
  'Aviso interno secreto',
  'Visita secreta',
  'Presupuesto secreto',
  'Nombre interno',
  'Ascensor interno',
  'Nota interna',
  'meta interna',
  '4321.00',
  'community_insurance',
  'Propietaria Alba',
  'Propietario Beltrán',
];
const keysOf = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  return out;
};
const expectNothingInternal = (body: unknown) => {
  const keys = keysOf(body);
  for (const forbidden of FORBIDDEN_KEYS)
    expect(keys.has(forbidden)).toBe(false);
  const text = JSON.stringify(body);
  for (const secret of FORBIDDEN_TEXT) expect(text).not.toContain(secret);
};

describe('las incidencias son de la comunidad, no de una vivienda', () => {
  it('todos los miembros activos ven las MISMAS incidencias de la comunidad (da igual su vivienda)', async () => {
    const seen: string[][] = [];
    for (const who of ['ownerA', 'ownerB'] as const) {
      const list = await http()
        .get(`${API}/estates/${estateId}/issues`)
        .set(auth(tokens[who]));
      expect(list.status).toBe(200);
      seen.push(list.body.items.map((i: { id: string }) => i.id).sort());
    }
    expect(seen[0]).toEqual([common, managerCommon].sort());
    expect(seen[1]).toEqual(seen[0]);
  });

  it('ya no hay incidencias POR VIVIENDA: ni se listan ni se crean desde una propiedad', async () => {
    const list = await http()
      .get(`${API}/properties/${propertyA}/issues`)
      .set(auth(tokens.ownerA));
    expect(list.status).toBe(404);
    const create = await http()
      .post(`${API}/properties/${propertyA}/issues`)
      .set(auth(tokens.ownerA))
      .send(payload('Por vivienda'));
    expect(create.status).toBe(404);
    const manager = await http()
      .post(`${API}/properties/${propertyA}/issues`)
      .set(auth(tokens.manager))
      .send(payload('Por vivienda'));
    expect(manager.status).toBe(404);
  });
});

describe('common · quién la ve (miembro ACTIVO, en la base de datos)', () => {
  it('dos miembros activos, de viviendas distintas, la ven (listado y detalle)', async () => {
    for (const who of ['ownerA', 'ownerB'] as const) {
      const detail = await http()
        .get(`${API}/issues/${common}`)
        .set(auth(tokens[who]));
      expect(detail.status).toBe(200);
      expect(detail.body.title).toBe('Ascensor averiado');
      const list = await http()
        .get(`${API}/estates/${estateId}/issues`)
        .set(auth(tokens[who]));
      expect(list.body.items.map((i: { id: string }) => i.id)).toContain(
        common,
      );
    }
  });

  it('NO la ven: otra comunidad, membresía revocada, pendiente, de una propiedad dada de baja, o sin membresía (aunque el JWT lleve la finca)', async () => {
    const missing = await http()
      .get(`${API}/issues/${ghost()}`)
      .set(auth(tokens.ownerB));
    for (const who of [
      'ownerOther',
      'revoked',
      'pending',
      'onDeletedProperty',
      'selfService',
    ] as const) {
      const res = await http()
        .get(`${API}/issues/${common}`)
        .set(auth(tokens[who]));
      expect(res.status).toBe(404);
      expect(shape(res.body)).toEqual(shape(missing.body));
      const photos = await http()
        .get(`${API}/issues/${common}/photos/${ghost()}/file`)
        .set(auth(tokens[who]));
      expect(photos.status).toBe(404);
      if (who !== 'ownerOther') {
        const list = await http()
          .get(`${API}/estates/${estateId}/issues`)
          .set(auth(tokens[who]));
        expect(list.status).toBe(200);
        expect(list.body.items).toEqual([]);
        expect(list.body.total).toBe(0);
      }
    }
  });

  it('un JWT viejo no basta: tras revocar la membresía en la base de datos, el MISMO token deja de verla', async () => {
    const late = await createOwnerUser(prisma, { fullName: 'Se da de baja' });
    await link(propertyB, late);
    const token = sign('C', late, null, [estateId]);
    try {
      expect(
        (await http().get(`${API}/issues/${common}`).set(auth(token))).status,
      ).toBe(200);
      await prisma.propertyMembership.updateMany({
        where: { userId: late },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      expect(
        (await http().get(`${API}/issues/${common}`).set(auth(token))).status,
      ).toBe(404);
      const create = await http()
        .post(`${API}/estates/${estateId}/issues`)
        .set(auth(token))
        .send(payload('Ya no soy miembro'));
      expect(create.status).toBe(403);
    } finally {
      await prisma.propertyMembership.deleteMany({ where: { userId: late } });
      await prisma.user.delete({ where: { id: late } });
    }
  });

  it('la gestión de la finca y la plataforma (en modo soporte) la ven; la gestión de OTRA finca, no', async () => {
    expect(
      (await http().get(`${API}/issues/${common}`).set(auth(tokens.manager)))
        .status,
    ).toBe(200);
    // La plataforma solo entra en datos de un despacho con una sesión de soporte suya.
    expect(
      (await http().get(`${API}/issues/${common}`).set(auth(tokens.platform)))
        .status,
    ).toBe(403);
    const session = await prisma.supportSession.create({
      data: {
        staffUserId: platformId,
        administratorId: adminId,
        reason: 'Revisar una incidencia',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    try {
      expect(
        (
          await http()
            .get(`${API}/issues/${common}`)
            .set(auth(tokens.platform))
            .set('X-Support-Session', session.id)
        ).status,
      ).toBe(200);
    } finally {
      await prisma.staffAuditLog.deleteMany({
        where: { staffUserId: platformId },
      });
      await prisma.supportSession.delete({ where: { id: session.id } });
    }
    const foreign = await http()
      .get(`${API}/issues/${common}`)
      .set(auth(tokens.otherManager));
    expect(foreign.status).toBe(403);
    const crossEstate = await http()
      .get(`${API}/issues/${otherCommon}`)
      .set(auth(tokens.ownerA));
    expect(crossEstate.status).toBe(404);
  });
});

describe('common · lo que ve un vecino (lista blanca)', () => {
  it('el detalle tiene EXACTAMENTE los campos permitidos y nada interno', async () => {
    const res = await http()
      .get(`${API}/issues/${common}`)
      .set(auth(tokens.ownerB));
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'closedAt',
        'createdAt',
        'date',
        'description',
        'estateId',
        'id',
        'location',
        'photos',
        'priority',
        'rating',
        'ratingComment',
        'ref',
        'reportedByMe',
        'resolvedAt',
        'source',
        'status',
        'timeline',
        'title',
        'type',
      ].sort(),
    );
    expect(res.body.reportedByMe).toBe(false);
    expectNothingInternal(res.body);
  });

  it('el historial público: solo los tipos permitidos, sin nombres de personas ni referencias internas', async () => {
    const res = await http()
      .get(`${API}/issues/${common}`)
      .set(auth(tokens.ownerB));
    const kinds = res.body.timeline.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['report_received', 'note']));
    for (const kind of kinds)
      expect([
        'report_received',
        'status_changed',
        'note',
        'visit_scheduled',
        'appointment_confirmed',
      ]).toContain(kind);
    const texts = res.body.timeline.map((e: { text: string }) => e.text);
    expect(texts).toContain('Nota pública de la administración');
    expect(texts).not.toContain('Nota interna de la gestión');
    const authors = res.body.timeline.map((e: { author: string }) => e.author);
    expect(authors).toContain('Administración');
    expect(authors).toContain('Un vecino'); // quien reportó, visto por otro vecino
  });

  it('el listado trae la MISMA proyección de lista blanca', async () => {
    const res = await http()
      .get(`${API}/estates/${estateId}/issues`)
      .set(auth(tokens.ownerB));
    expectNothingInternal(res.body);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('las lecturas auxiliares de la gestión están cerradas al rol C (también para su propia incidencia)', async () => {
    for (const path of [
      `/issues/${common}/provider`,
      `/issues/${common}/provider/history`,
      `/issues/${common}/notifications`,
      `/issues/${common}/situation`,
      `/issues/${common}/visits`,
      `/issues/${common}/insurance-claims`,
    ]) {
      for (const who of ['ownerA', 'ownerB'] as const) {
        const res = await http().get(`${API}${path}`).set(auth(tokens[who]));
        expect(res.status).toBe(403);
      }
    }
  });

  it('el vecino no recibe la asignación de proveedores ni los avisos enviados, y la gestión sí', async () => {
    const res = await http()
      .get(`${API}/issues/${common}`)
      .set(auth(tokens.ownerA));
    expect(res.status).toBe(200);
    expect(res.body.providerAssignments).toBeUndefined();
    expect(res.body.notifications).toBeUndefined();
  });

  it('la gestión ve la común COMPLETA, con sus datos internos', async () => {
    const res = await http()
      .get(`${API}/issues/${common}`)
      .set(auth(tokens.manager));
    expect(res.status).toBe(200);
    expect(res.body.providerAssignments).toHaveLength(1);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.resolutionRoute).toBe('community_insurance');
    expect(res.body.reports).toHaveLength(1);
  });
});

describe('common · quién puede escribir', () => {
  it('cualquier miembro activo reporta una; queda como REPORTANTE, no como dueño', async () => {
    const res = await http()
      .post(`${API}/estates/${estateId}/issues`)
      .set(auth(tokens.ownerB))
      .send(payload('Luz del portal fundida'));
    expect(res.status).toBe(201);
    expect(res.body.reportedByMe).toBe(true);
    expectNothingInternal(res.body);
    const row = await prisma.issue.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { reports: true },
    });
    expect(row).toMatchObject({ estateId, source: 'Propietario' });
    expect(row.reports.map((r) => r.reporterUserId)).toEqual([ownerB]);
  });

  it('la gestión la da de alta en nombre de la comunidad (con instalación opcional); un vecino no puede vincular instalación', async () => {
    const asset = await prisma.asset.create({
      data: { estateId, name: 'Portal', category: 'Accesos' },
    });
    const ok = await http()
      .post(`${API}/estates/${estateId}/issues`)
      .set(auth(tokens.manager))
      .send(payload('Portal con la cerradura rota', { assetId: asset.id }));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      source: 'Comunidad',
      assetId: asset.id,
    });
    const denied = await http()
      .post(`${API}/estates/${estateId}/issues`)
      .set(auth(tokens.ownerA))
      .send(payload('Con instalación', { assetId: asset.id }));
    expect(denied.status).toBe(400);
  });

  it('un no miembro NO crea una común; la gestión de otra finca tampoco', async () => {
    for (const who of [
      'revoked',
      'pending',
      'selfService',
      'onDeletedProperty',
    ] as const) {
      const res = await http()
        .post(`${API}/estates/${estateId}/issues`)
        .set(auth(tokens[who]))
        .send(payload('Intrusa'));
      expect(res.status).toBe(403);
    }
    expect(
      (
        await http()
          .post(`${API}/estates/${estateId}/issues`)
          .set(auth(tokens.ownerOther))
          .send(payload('De otra finca'))
      ).status,
    ).toBe(403);
    expect(
      (
        await http()
          .post(`${API}/estates/${estateId}/issues`)
          .set(auth(tokens.otherManager))
          .send(payload('De otra gestora'))
      ).status,
    ).toBe(403);
    expect(
      await prisma.issue.count({
        where: {
          title: { in: ['Intrusa', 'De otra finca', 'De otra gestora'] },
        },
      }),
    ).toBe(0);
  });

  it('notas: el reportante y la gestión sí; otro miembro NO (la ve, pero no escribe)', async () => {
    const reporter = await http()
      .post(`${API}/issues/${common}/timeline`)
      .set(auth(tokens.ownerA))
      .send({ text: 'Sigue sin funcionar desde ayer' });
    expect(reporter.status).toBe(201);
    const before = await prisma.issueTimelineEntry.count({
      where: { issueId: common },
    });
    const neighbour = await http()
      .post(`${API}/issues/${common}/timeline`)
      .set(auth(tokens.ownerB))
      .send({ text: 'Yo también lo he visto' });
    expect(neighbour.status).toBe(403);
    expect(
      await prisma.issueTimelineEntry.count({ where: { issueId: common } }),
    ).toBe(before);
    const outsider = await http()
      .post(`${API}/issues/${common}/timeline`)
      .set(auth(tokens.revoked))
      .send({ text: 'Intruso' });
    expect(outsider.status).toBe(404);
    const manager = await http()
      .post(`${API}/issues/${common}/timeline`)
      .set(auth(tokens.manager))
      .send({ text: 'Avisamos al técnico' });
    expect(manager.status).toBe(201);
  });

  it('la nota del reportante llega a la gestión como novedad (una tarea), igual que en una vivienda', async () => {
    const tasks = await prisma.agendaTask.count({ where: { issueId: common } });
    expect(tasks).toBeGreaterThanOrEqual(1);
  });

  it('fotos: las sube el reportante (y la gestión); las ve cualquier miembro; un no miembro, nada', async () => {
    const own = await http()
      .post(`${API}/issues/${common}/photos`)
      .set(auth(tokens.ownerA))
      .attach('file', jpeg, {
        filename: 'ascensor.jpg',
        contentType: 'image/jpeg',
      });
    expect(own.status).toBe(201);
    const photo = own.body.id as string;

    const neighbour = await http()
      .post(`${API}/issues/${common}/photos`)
      .set(auth(tokens.ownerB))
      .attach('file', jpeg, {
        filename: 'otra.jpg',
        contentType: 'image/jpeg',
      });
    expect(neighbour.status).toBe(403);
    const outsider = await http()
      .post(`${API}/issues/${common}/photos`)
      .set(auth(tokens.revoked))
      .attach('file', jpeg, {
        filename: 'intruso.jpg',
        contentType: 'image/jpeg',
      });
    expect(outsider.status).toBe(404);
    const manager = await http()
      .post(`${API}/issues/${common}/photos`)
      .set(auth(tokens.manager))
      .attach('file', jpeg, {
        filename: 'tecnico.jpg',
        contentType: 'image/jpeg',
      });
    expect(manager.status).toBe(201);
    expect(await prisma.issuePhoto.count({ where: { issueId: common } })).toBe(
      2,
    );

    // Las ve cualquier miembro, no las ve quien no lo es.
    expect(
      (
        await http()
          .get(`${API}/issues/${common}/photos/${photo}/file`)
          .set(auth(tokens.ownerB))
      ).status,
    ).toBe(200);
    expect(
      (
        await http()
          .get(`${API}/issues/${common}/photos/${photo}/file`)
          .set(auth(tokens.pending))
      ).status,
    ).toBe(404);
    // Y el detalle las lista SIN su clave de almacenamiento.
    const detail = await http()
      .get(`${API}/issues/${common}`)
      .set(auth(tokens.ownerB));
    expect(detail.body.photos).toHaveLength(2);
    expect(Object.keys(detail.body.photos[0]).sort()).toEqual([
      'id',
      'issueId',
      'uploadedAt',
    ]);
  });

  it('un vecino no tiene NINGUNA acción de gestión sobre una común', async () => {
    const attempts: [string, string, object?][] = [
      ['patch', `/issues/${common}/status`, { status: 'Cerrada' }],
      ['patch', `/issues/${common}/budget`, { budgetAmount: 1 }],
      ['patch', `/issues/${common}/asset`, { assetId: null }],
      ['post', `/issues/${common}/provider`, { providerNameSnapshot: 'X' }],
      [
        'post',
        `/issues/${common}/notifications`,
        { recipientsCount: 1, channel: 'email' },
      ],
      ['post', `/issues/${common}/interactions`, { channel: 'phone' }],
      ['put', `/issues/${common}/resolution-route`, { route: null }],
    ];
    for (const [method, path, body] of attempts) {
      const req = (
        http() as unknown as Record<string, (p: string) => request.Test>
      )
        [method](`${API}${path}`)
        .set(auth(tokens.ownerA));
      const res = await (body ? req.send(body) : req);
      expect([403, 404]).toContain(res.status);
    }
    expect(
      (await prisma.issue.findUniqueOrThrow({ where: { id: common } })).status,
    ).toBe('Abierta');
  });
});
