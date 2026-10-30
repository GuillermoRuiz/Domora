import { test, expect, type Page } from '@playwright/test';

const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const owner = {
  email: process.env.E2E_OWNER_EMAIL ?? 'maria.garcia@demo.app',
  password: process.env.E2E_OWNER_PASSWORD ?? 'owner123',
};

async function signIn(page: Page): Promise<void> {
  const response = await page.request.post(`${api}/auth/login`, { data: owner });
  expect(response.ok(), `Owner login: HTTP ${response.status()}`).toBe(true);
  const { refreshToken } = await response.json();
  await page.addInitScript((token) => localStorage.setItem('domora-refresh-token', token), refreshToken);
}

test.describe('owner dashboard (role C home)', () => {
  // One full page load per test: each load consumes the single-use refresh token.
  for (const path of ['/', '/this/route/does-not-exist']) {
    test(`${path} lands on Mi comunidad`, async ({ page }) => {
      await signIn(page);
      await page.goto(path);
      await expect(page).toHaveURL(/\/c\/community$/);
    });
  }

  test('shows the grouped sidebar, the topbar selector and every dashboard block', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/c/community');

    await expect(page.locator('.sidebar__section-label')).toHaveText(['GENERAL', 'OPERACIONES', 'SISTEMA']);
    await expect(page.locator('.sidebar__item-label')).toHaveText([
      'Mi comunidad', 'Incidencias', 'Documentación', 'Mensajes', 'Juntas', 'Recibos y pagos', 'Mi perfil',
    ]);
    await expect(page.locator('.topbar app-community-scope-selector')).toBeVisible();

    // Owners with several properties start on «Todas»: choose one property to see its estate blocks.
    await page.locator('.scope__btn').click();
    await page.locator('.scope__option:not([data-property="all"])').first().click();

    await expect(page.getByRole('heading', { name: 'Mi comunidad', level: 1 })).toBeVisible();
    await expect(page.getByText('Consulta el estado de tu comunidad, tus recibos, incidencias y documentos')).toBeVisible();
    await expect(page.locator('[data-scope-chip]')).toContainText('Ámbito actual:');
    await expect(page.locator('[data-kpi]')).toHaveCount(4);
    for (const title of ['Resumen de la comunidad', 'Mis recibos y pagos', 'Actividad reciente', 'Próximos eventos', 'Documentos recientes', 'Accesos rápidos']) {
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    }

    await page.getByRole('link', { name: 'Documentación', exact: true }).click();
    await expect(page).toHaveURL(/\/c\/documentacion$/);
    await expect(page.locator('.sidebar__item--active')).toHaveText('Documentación');
  });

  test('«Incidencias» opens the owner issues page from the sidebar', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/c/community');
    await page.getByRole('link', { name: 'Incidencias', exact: true }).click();
    await expect(page).toHaveURL(/\/c\/incidencias$/);
    await expect(page.locator('.sidebar__item--active')).toHaveText('Incidencias');
  });

  // Old links to the removed issues and documents tabs, and to /c/requests, land on their own pages.
  for (const [from, to] of [
    ['/c/requests', /\/c\/incidencias$/],
    ['/c/properties/any?tab=issues&issue=i1', /\/c\/incidencias\?issue=i1$/],
    ['/c/properties/any?tab=documents', /\/c\/documentacion$/],
  ] as const) {
    test(`${from} redirects to its own page`, async ({ page }) => {
      await signIn(page);
      await page.goto(from);
      await expect(page).toHaveURL(to);
    });
  }

  test('an owner with several properties can switch between «Todas mis propiedades» and one property', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/c/community');
    await page.locator('.scope__btn').click();
    const options = page.locator('.scope__option');
    test.skip((await options.count()) < 3, 'This owner has a single property: «Todas» is not offered.');

    await page.locator('[data-property="all"]').click();
    await expect(page.locator('[data-scope-chip]')).toContainText('Todas mis propiedades');
    await expect(page.locator('[data-community]').first()).toBeVisible();

    await page.locator('[data-community]').first().click();
    await expect(page.locator('[data-scope-chip]')).not.toContainText('Todas mis propiedades');
    await expect(page.locator('[data-community]')).toHaveCount(0);
  });

  test('fits a phone without horizontal scroll', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto('/c/community');
    await expect(page.locator('[data-kpi]')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
