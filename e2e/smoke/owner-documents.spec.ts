import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Owner «Documentación» end to end against the running stack (demo DB defaults:
 * `propietario@` and `moroso@` share an estate managed by `gestora@`; override with E2E_*).
 * The manager uploads three documents in the shared estate: one open to owners, one
 * addressed to the neighbour's home and one «Solo gestora». The owner only sees and
 * downloads the first; the other two answer 404 even by id.
 * Login throttle: 5/min per IP+email — each test signs in each account once.
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

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

async function upload(request: APIRequestContext, boss: Session, estateId: string, title: string, fields: Record<string, string>): Promise<string> {
  const res = await request.post(`${api}/estates/${estateId}/documents/upload`, {
    headers: auth(boss),
    multipart: { file: { name: `${title}.pdf`, mimeType: 'application/pdf', buffer: PDF }, title, ...fields },
  });
  expect(res.ok(), `upload ${title}: HTTP ${res.status()}`).toBe(true);
  return (await res.json()).id;
}

async function openAs(page: Page, session: Session, path: string): Promise<void> {
  await page.addInitScript((token) => localStorage.setItem('domora-refresh-token', token), session.refreshToken);
  await page.goto(path);
}

test('the owner sees, previews and downloads what is published for them, and nothing else', async ({ page, request }) => {
  const me = await login(request, owner);
  const other = await login(request, neighbour);
  const boss = await login(request, manager);
  const estateId = me.user.estateIds.find((id) => other.user.estateIds.includes(id));
  test.skip(!estateId, 'The owner and the neighbour do not share an estate in this database.');
  const library = await (await request.get(`${api}/estates/${estateId}/library`, { headers: auth(boss) })).json();
  const legal = library.folders.find((f: { systemKey: string | null }) => f.systemKey === 'legal');
  const neighbourProperty = ((await (await request.get(`${api}/users/${other.user.id}/memberships`, { headers: auth(other) })).json()) as { propertyId: string }[])[0].propertyId;
  const stamp = Date.now();
  const open = await upload(request, boss, estateId!, `Estatutos e2e ${stamp}`, { folderId: legal.id, visibility: 'OWNERS', description: 'Publicado para propietarios' });
  const forNeighbour = await upload(request, boss, estateId!, `Para el vecino e2e ${stamp}`, { folderId: legal.id, targetPropertyId: neighbourProperty });
  const managerOnly = await upload(request, boss, estateId!, `Solo gestora e2e ${stamp}`, { folderId: legal.id, visibility: 'MANAGER' });

  // API: listed under Normativa, nothing else; the hidden ones answer 404 even by id.
  const listing = await (await request.get(`${api}/me/documents?q=e2e%20${stamp}`, { headers: auth(me) })).json();
  expect(listing.items.map((d: { id: string }) => d.id)).toEqual([open]);
  expect(listing.items[0]).toMatchObject({ category: 'normativa', previewable: true, publishedBy: 'Administración de la comunidad' });
  expect(listing.items[0]).not.toHaveProperty('s3Key');
  for (const hidden of [forNeighbour, managerOnly]) {
    expect((await request.get(`${api}/documents/${hidden}/file`, { headers: auth(me) })).status()).toBe(404);
  }
  const file = await request.get(`${api}/documents/${open}/file?purpose=download`, { headers: auth(me) });
  expect(file.status()).toBe(200);
  expect(file.headers()['cache-control']).toContain('no-store');
  expect(file.headers()['content-disposition']).toContain("filename*=UTF-8''");

  // UI: sidebar → page → detail with preview → download.
  await openAs(page, me, '/c/community');
  await page.getByRole('link', { name: 'Documentación', exact: true }).click();
  await expect(page).toHaveURL(/\/c\/documentacion/);
  await page.getByRole('searchbox').or(page.locator('input[type=search]')).first().fill(`e2e ${stamp}`);
  const row = page.locator('tbody tr', { hasText: `Estatutos e2e ${stamp}` });
  await expect(row).toHaveCount(1);
  await expect(page.locator('tbody tr', { hasText: `Para el vecino e2e ${stamp}` })).toHaveCount(0);
  await row.click();
  await expect(page).toHaveURL(new RegExp(`doc=${open}`));
  await expect(page.locator('iframe[src^="blob:"]')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar', exact: true }).last().click();
  expect((await download).suggestedFilename()).toContain(`Estatutos e2e ${stamp}`);
});
