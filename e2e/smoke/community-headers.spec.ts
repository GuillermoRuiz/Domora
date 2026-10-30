import { test, expect } from '../fixtures/auth';

test('Tareas: el header gobierna todas las vistas y limpiar filtros conserva la comunidad', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/b/tasks');
  const scope = page.locator('.topbar select[aria-label="Comunidad"]');
  await expect.poll(() => scope.locator('option').count()).toBeGreaterThan(1);
  const estateId = (await scope
    .locator('option')
    .nth(1)
    .getAttribute('value'))!;
  const responseForScope = () =>
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/agenda/tasks') &&
        url.searchParams.get('estateId') === estateId &&
        response.request().method() === 'GET'
      );
    });
  const scoped = responseForScope();
  await scope.selectOption(estateId);
  expect((await scoped).status()).toBe(200);
  await expect(
    page.locator('app-task-filters [aria-label="Comunidad"]'),
  ).toHaveCount(0);
  for (const mode of ['Vista tabla', 'Vista kanban', 'Vista calendario']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(scope).toHaveValue(estateId);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator('app-task-filters')
    .getByRole('combobox', { name: 'Prioridad', exact: true })
    .click();
  const priority = responseForScope();
  await page.getByRole('option', { name: 'Alta', exact: true }).click();
  expect((await priority).status()).toBe(200);
  const cleared = responseForScope();
  await page
    .locator('app-task-filters')
    .getByRole('button', { name: 'Limpiar filtros', exact: true })
    .click();
  expect((await cleared).status()).toBe(200);
  await expect(scope).toHaveValue(estateId);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    for (const width of [1440, 900, 640, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await scope.scrollIntoViewIfNeeded();
      await expect(scope).toBeVisible();
      await expect(page.locator('.community-heading__control')).toHaveCSS(
        'height',
        '44px',
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      if (width === 1440 || width === 320)
        await page.screenshot({
          path: testInfo.outputPath(`tasks-${theme}-${width}.png`),
        });
    }
  }
  expect(errors).toEqual([]);
});

test('Informes: ámbito heredado desde el centro, categorías y visor, con un único selector en el header', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/b/reports');
  const scope = page.locator('.topbar .scope-trigger');
  await expect(scope).toBeEnabled();
  await scope.click();
  const firstName = (
    await page.locator('.scope-estate strong').first().innerText()
  ).trim();
  const first = page.locator('.scope-estate').first();
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await first.click();
  await page.keyboard.press('Escape');
  const estateId = new URL(page.url()).searchParams.get('estateIds')!;
  expect(estateId).toBeTruthy();
  await page
    .locator('a.report-card[href^="/b/reports/category/finance"]')
    .click();
  await expect(scope).toContainText(firstName);
  await page
    .locator('a.report-card[href^="/b/reports/view/trial-balance"]')
    .click();
  await expect(scope).toContainText(firstName);
  await expect(
    page.locator('.viewer-configuration app-report-estate-scope-selector'),
  ).toHaveCount(0);
  await expect(page.locator('app-report-estate-scope-selector')).toHaveCount(1);
  const generated = page.waitForResponse((response) =>
    response.url().endsWith('/reports/trial-balance/query'),
  );
  await page
    .getByRole('button', { name: 'Generar informe', exact: true })
    .click();
  const result = await generated;
  expect(result.status()).toBe(200);
  expect(result.request().postDataJSON()).toMatchObject({
    scopeMode: 'selected',
    estateIds: [estateId],
  });
  await expect(
    page.getByRole('heading', { name: 'Vista previa', exact: true }),
  ).toBeVisible();
  for (const theme of ['dark', 'light']) {
    await page.evaluate(
      (value) => document.documentElement.setAttribute('data-theme', value),
      theme,
    );
    for (const width of [1440, 900, 640, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await scope.click();
      await expect(
        page.getByRole('searchbox', { name: 'Buscar comunidad', exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      if (width === 1440 || width === 320)
        await page.screenshot({
          path: testInfo.outputPath(`report-${theme}-${width}.png`),
        });
      await page.keyboard.press('Escape');
    }
  }
  await scope.click();
  const secondName = (
    await page.locator('.scope-estate strong').nth(1).innerText()
  ).trim();
  await page.locator('.scope-estate').nth(1).click();
  await expect(
    page.getByRole('heading', { name: 'Vista previa', exact: true }),
  ).toHaveCount(0);
  await page.locator('.viewer-back').click();
  await expect(scope).toContainText(secondName);
  await page.locator('.back-link').click();
  await expect(scope).toContainText(secondName);
  await page.reload();
  await expect(scope).toContainText(secondName);
  expect(errors).toEqual([]);
});
