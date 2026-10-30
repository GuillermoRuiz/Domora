/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import type { AdminStatus } from '../src/prisma/client';
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  purgeAdministrator,
  uniqueCif,
  uniqueEmail,
  type AdministratorFixture,
} from '../src/testing/db-fixtures';
import { API, bearer, createE2eApp, type E2eApp } from './e2e-app';

/**
 * Global guard chain on the complete AppModule (JwtAuthGuard → RolesGuard →
 * SupportAccessGuard → SubscriptionStatusGuard → throttler) plus the error
 * format of database conflicts, with real PostgreSQL.
 */
jest.setTimeout(60_000);

const prisma = createPrismaClient();
let e2e: E2eApp;

let X: AdministratorFixture;
let Y: AdministratorFixture;
let estateX: string;
let estateY: string;
let staffId: string;
let ownerId: string;
let tokenA: string;
let tokenB: string;
let tokenC: string;
const createdAdminIds: string[] = [];

const setStatus = (administratorId: string, status: AdminStatus) =>
  prisma.administrator.update({
    where: { id: administratorId },
    data: { status },
  });

beforeAll(async () => {
  e2e = await createE2eApp();

  X = await createAdministrator(prisma, { name: 'Guards e2e · Despacho X' });
  Y = await createAdministrator(prisma, { name: 'Guards e2e · Despacho Y' });
  estateX = await createEstate(prisma, X.administratorId, {
    name: 'Guards e2e · finca X',
  });
  estateY = await createEstate(prisma, Y.administratorId, {
    name: 'Guards e2e · finca Y',
  });
  staffId = (
    await prisma.user.create({
      data: {
        email: uniqueEmail('e2e-staff'),
        passwordHash: 'x',
        fullName: 'Staff e2e',
        role: 'A',
      },
    })
  ).id;
  ownerId = await createOwnerUser(prisma);

  tokenA = e2e.sign('A', staffId, null, []);
  tokenB = e2e.sign('B', X.userId, X.administratorId, [estateX]);
  tokenC = e2e.sign('C', ownerId, null, []);
});

afterAll(async () => {
  for (const id of createdAdminIds) await purgeAdministrator(prisma, id);
  await purgeAdministrator(prisma, X.administratorId, [staffId, ownerId]);
  await purgeAdministrator(prisma, Y.administratorId);
  await e2e.app.close();
  await prisma.$disconnect();
});

describe('Authentication guard (e2e)', () => {
  it('a protected route without a token is 401', () => {
    return request(e2e.server).get(`${API}/estates`).expect(401);
  });

  it('a @Public() route needs no token', () => {
    return request(e2e.server).get(`${API}/health`).expect(200);
  });
});

describe('Roles guard (e2e)', () => {
  it('a gestora (B) cannot reach a platform-only route (A)', () => {
    return request(e2e.server)
      .get(`${API}/admins`)
      .set(bearer(tokenB))
      .expect(403);
  });

  it('an owner (C) cannot reach a gestora route (A, B)', () => {
    return request(e2e.server)
      .get(`${API}/estates/overview`)
      .set(bearer(tokenC))
      .expect(403);
  });

  it('the platform role (A) reaches its own route', () => {
    return request(e2e.server)
      .get(`${API}/admins`)
      .set(bearer(tokenA))
      .expect(200);
  });
});

describe('Tenant scope (e2e)', () => {
  it('a gestora reads her own estate', async () => {
    const res = await request(e2e.server)
      .get(`${API}/estates/${estateX}`)
      .set(bearer(tokenB))
      .expect(200);
    expect(res.body.id).toBe(estateX);
  });

  it("a gestora cannot read another despacho's estate", () => {
    return request(e2e.server)
      .get(`${API}/estates/${estateY}`)
      .set(bearer(tokenB))
      .expect(403);
  });

  it('an owner without memberships cannot read any estate', () => {
    return request(e2e.server)
      .get(`${API}/estates/${estateX}`)
      .set(bearer(tokenC))
      .expect(403);
  });
});

describe('Subscription guard (e2e)', () => {
  afterEach(() => setStatus(X.administratorId, 'Activa'));

  it('an expired subscription can still read but not write', async () => {
    await setStatus(X.administratorId, 'Vencida');
    await request(e2e.server)
      .get(`${API}/estates`)
      .set(bearer(tokenB))
      .expect(200);
    const res = await request(e2e.server)
      .post(`${API}/estates`)
      .set(bearer(tokenB))
      .send({})
      .expect(403);
    expect(res.body.code).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('a blocked account cannot even read', async () => {
    await setStatus(X.administratorId, 'Bloqueada');
    const res = await request(e2e.server)
      .get(`${API}/estates`)
      .set(bearer(tokenB))
      .expect(403);
    expect(res.body.code).toBe('SUBSCRIPTION_BLOCKED');
  });

  it('@SkipSubscriptionGate() routes still answer a blocked account', async () => {
    await setStatus(X.administratorId, 'Bloqueada');
    await request(e2e.server)
      .get(`${API}/auth/me`)
      .set(bearer(tokenB))
      .expect(200);
  });
});

describe('Database conflicts reach the client as 409 (e2e)', () => {
  it('a duplicated CIF is a 409 with the Spanish message, not a 500', async () => {
    const cif = uniqueCif('E2E');
    const body = (contactEmail: string) => ({
      name: 'Gestora e2e duplicada',
      cif,
      plan: 'BASE',
      contactEmail,
    });

    const first = await request(e2e.server)
      .post(`${API}/admins`)
      .set(bearer(tokenA))
      .send(body(uniqueEmail('e2e-cif')))
      .expect(201);
    createdAdminIds.push(first.body.id as string);

    const res = await request(e2e.server)
      .post(`${API}/admins`)
      .set(bearer(tokenA))
      .send(body(uniqueEmail('e2e-cif')))
      .expect(409);
    expect(res.body.message).toBe(
      `Ya existe una gestora registrada con el CIF ${cif}.`,
    );
  });
});
