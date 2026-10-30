import { test, expect } from '../fixtures/auth';

test.describe('Centro de Informes', () => {
  test('categorías, búsqueda y navegación semántica', async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const catalogResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/reports/catalog') && response.request().method() === 'GET');
    await page.goto('/b/reports');
    const response = await catalogResponse; expect(response.status()).toBe(200);
    const catalog = await response.json();
    await expect(page.getByRole('heading', { name: 'Informes', exact: true }).first()).toBeVisible();
    const categories = page.locator('a.report-card');
    await expect(categories).toHaveCount(7);
    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      for (const width of [1440, 900, 640, 320]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const expectedColumns = width > 900 ? 3 : width > 640 ? 2 : 1;
        expect(await page.locator('.report-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(expectedColumns);
        await page.screenshot({ path: testInfo.outputPath(`hub-${theme}-${width}.png`), fullPage: true });
      }
    }
    const report = catalog.reports.find((entry: { status: string }) => entry.status === 'available');
    await page.getByRole('searchbox', { name: 'Buscar informes', exact: true }).fill(report.title);
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: report.title, exact: true }) }).click();
    await expect(page).toHaveURL(new RegExp(`/b/reports/view/${report.key}$`));
    await expect(page.getByRole('heading', { name: 'Configurar informe' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generar informe', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('genera con alcance explícito y descarga PDF y Excel reales', async ({ page }) => {
    const catalogResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/reports/catalog'));
    await page.goto('/b/reports');
    const catalog = await (await catalogResponse).json();
    const report = catalog.reports.find((entry: { status: string; scopeMode: string; periodMode: string; filters: string[] }) => entry.status === 'available' && entry.scopeMode === 'multiple' && entry.periodMode === 'none' && entry.filters.length === 0);
    expect(report, 'Existe un listado de cartera real sin filtros obligatorios').toBeTruthy();
    await page.getByRole('searchbox', { name: 'Buscar informes', exact: true }).fill(report.title);
    await page.getByRole('link').filter({ has: page.getByRole('heading', { name: report.title, exact: true }) }).click();
    await expect(page).toHaveURL(new RegExp(`/b/reports/view/${report.key}$`));
    const scope = page.getByRole('button', { name: 'Seleccionar comunidades', exact: true });
    await scope.click();
    await expect(page.getByRole('searchbox', { name: 'Buscar comunidad', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Todas mis comunidades', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const firstEstate = page.locator('.scope-estate').first();
    await expect(firstEstate).toHaveAttribute('aria-pressed', 'false');
    await firstEstate.click();
    await page.keyboard.press('Escape'); await expect(scope).toBeFocused();
    const queried = page.waitForResponse(response => response.url().endsWith(`/reports/${report.key}/query`));
    await page.getByRole('button', { name: 'Generar informe', exact: true }).click();
    const response = await queried;
    expect(response.ok(), await response.text()).toBe(true);
    await expect(page.getByRole('heading', { name: 'Vista previa', exact: true })).toBeVisible();
    for (const [format, label] of [['pdf', 'Exportar PDF'], ['xlsx', 'Exportar Excel']]) {
      const download = page.waitForEvent('download'); await page.getByRole('button', { name: label, exact: true }).click();
      const file = await download; expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`)); expect(await file.failure()).toBeNull();
    }
    await scope.click();
    await page.getByRole('button', { name: 'Todas mis comunidades', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exportar PDF', exact: true })).toHaveCount(0);
  });

  test('abre todas las categorías con tarjetas compactas y sin pills de formato o alcance', async ({ page }) => {
    const response = page.waitForResponse(response => response.url().endsWith('/reports/catalog'));
    await page.goto('/b/reports');
    const catalog = await (await response).json();
    for (const category of catalog.categories) {
      const reports = catalog.reports.filter((report: { category: string; status: string }) => report.category === category.key && report.status === 'available');
      const card = page.locator(`a.report-card[href="/b/reports/category/${category.key}"]`);
      await expect(card).toContainText(`${reports.length} ${reports.length === 1 ? 'informe' : 'informes'}`);
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/b/reports/category/${category.key}$`));
      await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toContainText(category.title);
      await expect(page.locator('a.report-card')).toHaveCount(reports.length);
      await expect(page.locator('a.report-card app-badge')).toHaveCount(0);
      for (const report of reports) {
        const link = page.locator(`a.report-card[href="/b/reports/view/${report.key}"]`);
        await expect(link).toContainText(report.title);
        await expect(link).toContainText(report.description);
        await expect(link).toContainText('Abrir informe');
      }
      await page.getByRole('link', { name: '← Todas las categorías', exact: true }).click();
      await expect(page.locator('a.report-card')).toHaveCount(catalog.categories.length);
    }
    // La búsqueda ignora tildes y mayúsculas. Se espera a que se pinten los resultados (enlaces a informes,
    // no a categorías) antes de contarlos: count() no reintenta y leería aún las tarjetas de categoría.
    const results = page.locator('a.report-card[href^="/b/reports/view/"]');
    await page.getByRole('searchbox', { name: 'Buscar informes', exact: true }).fill('situación');
    await expect(results.first()).toBeVisible();
    await expect(page.locator('a.report-card[href^="/b/reports/category/"]')).toHaveCount(0);
    const accented = await results.count();
    await page.getByRole('searchbox', { name: 'Buscar informes', exact: true }).fill('SITUACION');
    await expect(results).toHaveCount(accented);
    expect(accented).toBeGreaterThan(0);
  });

  test('conserva la comunidad al editar el ejercicio y exporta el balance real', async ({ page }) => {
    await page.goto('/b/reports');
    await page.locator('a.report-card[href="/b/reports/category/finance"]').click();
    await page.locator('a.report-card[href="/b/reports/view/trial-balance"]').click();
    await page.getByRole('heading', { name: 'Configurar informe', exact: true }).waitFor();
    const year = await page.getByLabel('Ejercicio', { exact: true }).inputValue();
    await page.locator('.scope-trigger').click();
    await page.locator('.scope-estate').first().click();
    await page.keyboard.press('Escape');
    await page.getByLabel('Ejercicio', { exact: true }).fill(year);
    const query = page.waitForResponse(response => response.url().endsWith('/reports/trial-balance/query'));
    await page.getByRole('button', { name: 'Generar informe', exact: true }).click();
    const response = await query;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON().estateIds).toHaveLength(1);
    await expect(page.getByRole('heading', { name: 'Vista previa', exact: true })).toBeVisible();
    for (const label of ['Exportar PDF', 'Exportar Excel']) {
      const exported = page.waitForResponse(response => response.url().endsWith('/reports/trial-balance/export'));
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: label, exact: true }).click();
      const response = await exported;
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await (await download).failure()).toBeNull();
    }
  });

  test('un fallo de catálogo muestra carga fallida y Reintentar recupera el catálogo real', async ({ page }) => {
    // Fault injection is confined to this browser request; retry uses the real API.
    await page.route('**/api/v1/reports/catalog', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Temporary test failure"}' }), { times: 1 });
    await page.goto('/b/reports');
    await expect(page.getByRole('heading', { name: 'No se han podido cargar los informes', exact: true })).toBeVisible();
    await expect(page.getByText('No se ha podido generar el informe. Vuelve a intentarlo.', { exact: true })).toHaveCount(0);
    const response = page.waitForResponse(response => response.url().endsWith('/reports/catalog'));
    await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.locator('a.report-card')).toHaveCount(7);
  });
});
