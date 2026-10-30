/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { createPrismaClient } from '../src/prisma/create-prisma-client';
import { uniqueEmail } from '../src/testing/db-fixtures';
import { API, bearer, createE2eApp, type E2eApp } from './e2e-app';

/**
 * Authentication lifecycle through HTTP with real PostgreSQL: login, refresh
 * token rotation, logout revocation and the login rate limit.
 */
jest.setTimeout(60_000);

const prisma = createPrismaClient();
const PASSWORD = 'Secreta-e2e-123';
const createdUserIds: string[] = [];
let e2e: E2eApp;

async function createOwner(): Promise<string> {
  const email = uniqueEmail('e2e-auth');
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      fullName: 'Propietario e2e',
      role: 'C',
    },
  });
  createdUserIds.push(user.id);
  return email;
}

function login(email: string, password = PASSWORD) {
  return request(e2e.server)
    .post(`${API}/auth/login`)
    .send({ email, password });
}

function refresh(refreshToken: string) {
  return request(e2e.server).post(`${API}/auth/refresh`).send({ refreshToken });
}

beforeAll(async () => {
  e2e = await createE2eApp();
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({
    where: { userId: { in: createdUserIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await e2e.app.close();
  await prisma.$disconnect();
});

describe('Auth lifecycle (e2e)', () => {
  it('login returns a token pair whose access token opens protected routes', async () => {
    const email = await createOwner();
    const res = await login(email).expect(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        user: expect.objectContaining({ role: 'C' }),
      }),
    );

    const me = await request(e2e.server)
      .get(`${API}/auth/me`)
      .set(bearer(res.body.accessToken as string))
      .expect(200);
    expect(me.body).toEqual(expect.objectContaining({ email }));
  });

  it('a wrong password and an unknown email both get the same 401', async () => {
    const email = await createOwner();
    const wrong = await login(email, 'no-es-esta').expect(401);
    const unknown = await login(uniqueEmail('nadie')).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('refresh rotates the pair and the old refresh token stops working', async () => {
    const email = await createOwner();
    const first = (await login(email).expect(201)).body as {
      refreshToken: string;
    };

    const second = await refresh(first.refreshToken).expect(201);
    expect(second.body.refreshToken).toEqual(expect.any(String));
    expect(second.body.refreshToken).not.toBe(first.refreshToken);

    await refresh(first.refreshToken).expect(401);
    await refresh(second.body.refreshToken as string).expect(201);
  });

  it('logout revokes the refresh token', async () => {
    const email = await createOwner();
    const { refreshToken } = (await login(email).expect(201)).body as {
      refreshToken: string;
    };

    await request(e2e.server)
      .post(`${API}/auth/logout`)
      .send({ refreshToken })
      .expect(204);
    await refresh(refreshToken).expect(401);
  });

  it('a garbage bearer token is rejected with 401', () => {
    return request(e2e.server)
      .get(`${API}/auth/me`)
      .set(bearer('no-es-un-jwt'))
      .expect(401);
  });

  it('the sixth login attempt in a minute for the same email gets 429', async () => {
    const email = await createOwner();
    for (let i = 0; i < 5; i++) await login(email, 'mal').expect(401);
    const res = await login(email).expect(429);
    expect(res.body.message).toBe(
      'Demasiados intentos de acceso. Espera un minuto.',
    );
  });
});
