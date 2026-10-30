import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Owner «Incidencias» end to end against the running stack.
 * Defaults target the demo DB (`npm run demo:seed`): `propietario@` and `moroso@`
 * share an estate; `gestora@` manages it. Override with the E2E_* variables.
 * The login throttle is 5/min per IP+email: each test signs in each account once.
 */
const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const password = process.env.E2E_DEMO_PASSWORD ?? 'Demo2026!';
const owner = process.env.E2E_OWNER_EMAIL ?? 'propietario@demo.domora.app';
const neighbour = process.env.E2E_NEIGHBOUR_EMAIL ?? 'moroso@demo.domora.app';
const manager = process.env.E2E_MANAGER_EMAIL ?? 'gestora@demo.domora.app';

type Session = { accessToken: string; refreshToken: string; user: { id: string; estateIds: string[] } };

async function login(request: APIRequestContext, email: string): Promise<Session> {
  const res = await request.post(`${api}/auth/login`, { data: { email, password: email === owner ? process.env.E2E_OWNER_PASSWORD ?? password : password } });
  expect(res.ok(), `login ${email}: HTTP ${res.status()}`).toBe(true);
  return res.json();
}
const auth = (s: Session) => ({ Authorization: `Bearer ${s.accessToken}` });

/** The community the owner and the neighbour share: issues belong to it, never to a home. */
function sharedEstate(me: Session, other: Session): string {
  const shared = me.user.estateIds.find((id) => other.user.estateIds.includes(id));
  test.skip(!shared, 'The owner and the neighbour do not share an estate in this database.');
  return shared!;
}

async function openAs(page: Page, session: Session, path: string): Promise<void> {
  await page.addInitScript((token) => localStorage.setItem('domora-refresh-token', token), session.refreshToken);
  await page.goto(path);
}

test.describe('owner issues', () => {
  test('the owner creates an issue in the community with a PDF; a neighbour sees it without the file and cannot act on it', async ({ page, request }) => {
    const me = await login(request, owner);
    const other = await login(request, neighbour);
    const estateId = sharedEstate(me, other);
    const title = `Cerradura del portal e2e ${Date.now()}`;

    await openAs(page, me, '/c/community');
    await page.getByRole('link', { name: 'Incidencias', exact: true }).click();
    await expect(page).toHaveURL(/\/c\/incidencias/);
    await page.locator('[data-action="new-issue"]').click();
    await expect(page.locator('[data-field="title"]')).toBeVisible();
    const estate = page.locator('[data-field="estate"]');
    if (await estate.count()) await estate.selectOption(estateId);
    // «Nueva incidencia» no pregunta qué tipo de aviso es.
    await expect(page.locator('[data-category]')).toHaveCount(0);
    await page.locator('[data-field="title"]').fill(title);
    await page.locator('[data-field="description"]').fill('La llave del portal no gira bien en la cerradura.');
    const location = page.locator('[data-field="location"]');
    // Zones and installations of the community; the owner's home is never offered.
    await expect(location.locator('option', { hasText: 'Zona común' })).toHaveCount(1);
    await expect(location.locator('option', { hasText: 'vivienda' })).toHaveCount(0);
    await location.selectOption({ label: 'Zona común' });
    await page.locator('[data-field="files"]').setInputFiles({ name: 'autorizacion.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
    await page.locator('button[type=submit]').click();

    await expect(page).toHaveURL(/\/c\/incidencias\?issue=/);
    await expect(page.locator('[data-detail-title]')).toHaveText(title);
    await expect(page.locator('[data-attachments]')).toContainText('autorizacion.pdf');
    const issueId = new URL(page.url()).searchParams.get('issue')!;

    // The issue is the community's: a neighbour sees it, but without the files and without being able to act on it.
    const seen = await (await request.get(`${api}/me/issues`, { headers: auth(other) })).json();
    expect(seen.items.map((i: { id: string }) => i.id)).toContain(issueId);
    const asNeighbour = await (await request.get(`${api}/me/issues/${issueId}`, { headers: auth(other) })).json();
    expect(asNeighbour).toMatchObject({ mine: false, canReply: false, canWithdraw: false, attachments: [] });
    expect(asNeighbour).not.toHaveProperty('propertyId');
    expect((await request.post(`${api}/me/issues/${issueId}/withdraw`, { headers: auth(other) })).status()).toBe(403);
  });

  test('the manager asks for information and the owner\'s reply gives the issue back its status', async ({ page, request }) => {
    const me = await login(request, owner);
    const other = await login(request, neighbour);
    const estateId = sharedEstate(me, other);
    const boss = await login(request, manager);
    const created = await (await request.post(`${api}/me/issues`, {
      headers: auth(me),
      data: { estateId, title: `Humedad e2e ${Date.now()}`, description: 'Manchas en la pared.', location: 'Zona común', urgent: false },
    })).json();
    const ask = await request.post(`${api}/issues/${created.id}/request-info`, { headers: auth(boss), data: { text: '¿En qué habitación?' } });
    expect(ask.ok(), `request-info: HTTP ${ask.status()}`).toBe(true);

    await openAs(page, me, `/c/incidencias?issue=${created.id}`);
    await expect(page.locator('[data-info-banner]')).toBeVisible();
    await page.locator('[data-reply] textarea, textarea[data-reply]').first().fill('En el dormitorio que da al patio.');
    await page.locator('[data-action="reply"]').click();
    await expect(page.locator('[data-info-banner]')).toHaveCount(0);

    const detail = await (await request.get(`${api}/me/issues/${created.id}`, { headers: auth(me) })).json();
    expect(detail.status).toBe('Abierta');
    expect(detail.timeline.map((t: { text: string }) => t.text)).toEqual(expect.arrayContaining(['¿En qué habitación?', 'En el dormitorio que da al patio.']));
  });
});
