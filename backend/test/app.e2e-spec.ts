/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import request from 'supertest';
import { API, createE2eApp, type E2eApp } from './e2e-app';

/**
 * Bootstrap shared with main.ts: global prefix, helmet headers, CORS and the
 * global ValidationPipe.
 */
describe('App bootstrap (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await createE2eApp();
  });

  afterAll(async () => {
    await e2e.app.close();
  });

  it('GET /api/v1 answers without a token', () => {
    return request(e2e.server).get(API).expect(200).expect('Hello World!');
  });

  it('routes live under the /api/v1 prefix only', () => {
    return request(e2e.server).get('/health').expect(404);
  });

  it('sends the helmet security headers configured in main.ts', async () => {
    const res = await request(e2e.server).get(API).expect(200);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-site');
    expect(res.headers['x-powered-by']).toBeUndefined();
    // CSP belongs to nginx (it serves the SPA), not to this JSON API.
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  describe('CORS', () => {
    const allowed = (process.env.CORS_ORIGIN?.split(',') ?? [
      'http://localhost:4200',
    ])[0];

    it('lets the configured frontend origin call the API with credentials', async () => {
      const res = await request(e2e.server)
        .options(`${API}/auth/login`)
        .set('Origin', allowed)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(allowed);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not allow an unknown origin', async () => {
      const res = await request(e2e.server)
        .options(`${API}/auth/login`)
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('exposes X-Agenda-Truncated to the browser', async () => {
      const res = await request(e2e.server)
        .get(API)
        .set('Origin', allowed)
        .expect(200);
      expect(res.headers['access-control-expose-headers']).toContain(
        'X-Agenda-Truncated',
      );
    });
  });

  describe('global ValidationPipe', () => {
    it('rejects properties the DTO does not declare (forbidNonWhitelisted)', async () => {
      const res = await request(e2e.server)
        .post(`${API}/auth/login`)
        .send({
          email: 'nadie@test.local',
          password: 'x',
          role: 'A',
        })
        .expect(400);
      expect(res.body.message).toContain('property role should not exist');
    });

    it('rejects a malformed field before reaching the service', async () => {
      const res = await request(e2e.server)
        .post(`${API}/auth/login`)
        .send({ email: 'no-es-un-email', password: 'x' })
        .expect(400);
      expect(res.body.message).toContain('email must be an email');
    });
  });
});
