import { test, expect } from '../fixtures/auth';

const isMobile = (projectName: string) => projectName.startsWith('mobile-');

/**
 * Flujo 2 de 4 de la fase 6 (ID 29). El que más ejercita el trabajo de
 * responsive de ID 27: el drawer del sidebar (fase 1) y la tab bar con
 * overflow-x de estate-detail (fase 2a) — no solo "la página carga".
 */
test.describe('Dashboard de fincas y detalle de finca', () => {
  test('header conserva sus dimensiones al alternar comunidad y todas las fincas', async ({ page }) => {
    await page.goto('/b/estates');
    for (const width of [1440, 1024, 768, 640, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('.communities-table')).toBeVisible();
      const allHeader = await page.locator('.topbar').boundingBox();
      const allSelector = await page.locator('.scope-trigger').boundingBox();
      await page.locator('.scope-trigger').click();
      await page.locator('.scope-results button').first().click();
      const trigger = page.locator('.community-selector__trigger');
      await expect(trigger).toBeVisible();
      const selectedHeader = await page.locator('.topbar').boundingBox();
      const selectedSelector = await trigger.boundingBox();
      for (const dimension of ['x', 'y', 'width', 'height'] as const) {
        expect(selectedHeader![dimension], `header ${dimension} at ${width}px`).toBeCloseTo(allHeader![dimension], 0);
        expect(selectedSelector![dimension], `selector ${dimension} at ${width}px`).toBeCloseTo(allSelector![dimension], 0);
      }
      await trigger.click();
      await page.getByRole('button', { name: 'Ver todas las fincas', exact: true }).click();
    }
  });
  test('filtro multiselección y descarga Excel del listado', async ({ page }) => {
    await page.goto('/b/estates');
    await expect(page.locator('.communities-table tbody tr').first()).toBeVisible();
    await expect(page.locator('.sort-control, .direction-btn')).toHaveCount(0);
    // Desplegable múltiple de la app (combobox + listbox): cada opción se marca o desmarca y la lista sigue abierta.
    const trigger = page.getByRole('combobox', { name: 'Filtrar por tipo de finca' });
    await trigger.click();
    const panel = page.getByRole('listbox', { name: 'Filtrar por tipo de finca' });
    await panel.getByRole('option', { name: 'Edificio', exact: true }).click();
    const request = page.waitForResponse(r => r.url().includes('/estates/overview?') && new URL(r.url()).searchParams.get('types') === 'Edificio,Garaje');
    await panel.getByRole('option', { name: 'Garaje', exact: true }).click();
    expect((await request).status()).toBe(200);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('option', { selected: true })).toHaveCount(2);
    await expect(trigger).toHaveText('Filtrar (2)');
    const bounds = await panel.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    const button = page.getByRole('button', { name: 'Descargar comunidades en Excel' });
    await expect(button).toBeEnabled();
    const downloaded = page.waitForEvent('download');
    await button.click();
    const file = await downloaded;
    expect(file.suggestedFilename()).toBe('comunidades.xlsx');
    expect(await file.failure()).toBeNull();
  });
  test('lista fincas y el shell responde según el viewport', async ({ page }, testInfo) => {
    await page.goto('/b/estates');
    await expect(page.locator('.compact-summary')).toContainText('comunidades');
    await expect(page.locator('.communities-table')).toBeVisible();

    if (isMobile(testInfo.project.name)) {
      // Bajo el breakpoint tablet: sidebar colapsado por defecto, hamburguesa visible.
      await expect(page.locator('.topbar__menu-btn')).toBeVisible();
      await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--open/);

      await page.locator('.topbar__menu-btn').click();
      await expect(page.locator('.sidebar')).toHaveClass(/sidebar--open/);
      await expect(page.locator('.sidebar__backdrop')).toBeVisible();

      await page.locator('.sidebar__backdrop').click({ position: { x: page.viewportSize()!.width - 10, y: 20 } });
      await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--open/);
    } else {
      // Desktop: sidebar siempre visible, sin hamburguesa.
      await expect(page.locator('.topbar__menu-btn')).toBeHidden();
      await expect(page.locator('.sidebar__nav')).toBeVisible();
    }
  });

  test('detalle de finca: tabs navegables sin desbordar', async ({ page }) => {
    await page.goto('/b/estates');
    await page.getByRole('link', { name: 'Ver finca' }).first().click();
    await page.waitForURL('**/b/estates/*');

    const tabs = page.locator('.estate-subnav');
    await expect(tabs).toBeVisible();

    await expect(tabs.locator('.estate-subnav__item')).toHaveCount(7);
    const propertiesTab = page.locator('.estate-subnav__item', { hasText: 'Propiedades' });
    await propertiesTab.click();
    await expect(propertiesTab).toHaveClass(/estate-subnav__item--active/);
    await expect(page.locator('[data-estate-tab="issues"], [data-estate-tab="juntas"]')).toHaveCount(0);
  });

  test('«Volver a todas las fincas» regresa al listado aunque haya una finca elegida', async ({ page }) => {
    await page.goto('/b/estates');
    await page.getByRole('link', { name: 'Ver finca' }).first().click();
    await page.waitForURL('**/b/estates/*');

    await page.getByRole('link', { name: 'Volver a todas las fincas' }).click();
    await expect(page.locator('.communities-table')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/b/estates');
  });

  test('menú de acciones del listado: ofrece las acciones y abre la elegida en la ficha sin dejar ?action= en la URL', async ({ page }) => {
    await page.goto('/b/estates');
    const trigger = page.locator('.communities-table tbody .trigger').first();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    for (const name of [/Editar finca/, /Importar del Catastro/, /Nueva propiedad/]) {
      await expect(page.getByRole('menuitem', { name })).toBeVisible();
    }

    // Escape cierra y devuelve el foco al botón.
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole('menuitem', { name: /Importar del Catastro/ }).click();
    await page.waitForURL('**/b/estates/*');
    await expect(page).not.toHaveURL(/action=/);
  });

  test('tabla/cards comparten resultados, preferencia y consultas', async ({ page }) => {
    let overviewRequests = 0;
    page.on('request', request => { if (request.url().includes('/estates/overview')) overviewRequests++; });
    await page.goto('/b/estates');
    await expect(page.locator('.communities-table tbody tr').first()).toBeVisible();
    const names = await page.locator('.community-name').allTextContents();
    await page.getByRole('button', { name: 'Vista cards', exact: true }).click();
    await expect(page.locator('.estate-card').first()).toBeVisible();
    expect(await page.locator('.estate-card__name').allTextContents()).toEqual(names);
    const cardText = await page.locator('.estate-card').first().innerText();
    expect(cardText).toContain('Cuotas pendientes');
    await expect(page.locator('.estate-card__issues').first()).toContainText('Incidencias');
    await expect(page.locator('.card-pending').first()).toContainText('€');
    for (const forbidden of ['solicitudes', 'Ocupación', 'Propiedades', 'Configuración', 'Ver finca']) expect(cardText).not.toContain(forbidden);
    expect(overviewRequests).toBe(1);
    await page.getByRole('button', { name: 'Vista tabla', exact: true }).click();
    expect(overviewRequests).toBe(1);
    await page.getByRole('searchbox', { name: 'Buscar comunidades por nombre o dirección' }).fill('no existe esta comunidad');
    await expect(page.getByText('No hay comunidades que coincidan con tu búsqueda o filtros.')).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar filtros' }).click();
    await expect(page.locator('.communities-table')).toBeVisible();
  });

  test('responsive conserva tabla y cards sin desbordamiento de página', async ({ page }) => {
    await page.goto('/b/estates');
    await expect(page.locator('.communities-table')).toBeVisible();
    for (const width of [1440, 900, 640, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `tmp/fincas-table-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Vista cards', exact: true }).click();
      await expect(page.locator('.estate-card').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `tmp/fincas-cards-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Vista tabla', exact: true }).click();
    }
  });

  test('tema claro, teclado y búsquedas reales', async ({ page }, testInfo) => {
    await page.goto('/b/estates');
    await expect(page.locator('.communities-table')).toBeVisible();
    await page.getByRole('button', { name: 'Abrir menú de cuenta', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Modo claro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: 'tmp/fincas-table-light.png', fullPage: true });
    await page.getByRole('button', { name: 'Vista cards', exact: true }).click();
    await page.screenshot({ path: 'tmp/fincas-cards-light.png', fullPage: true });
    await page.getByRole('button', { name: 'Todas mis comunidades', exact: true }).click();
    const scopeSearch = page.getByRole('searchbox', { name: 'Buscar comunidad', exact: true });
    await expect(scopeSearch).toBeFocused();
    await scopeSearch.press('ArrowDown');
    await expect(page.locator('.scope-all')).toBeFocused();
    await page.locator('.scope-all').press('Escape');
    await expect(page.locator('.scope-menu')).toBeHidden();
    await expect(page.locator('.scope-trigger')).toBeFocused();
    const headerSearch = page.getByRole('searchbox', { name: 'Buscar comunidades, propietarios e incidencias' });
    await headerSearch.fill('Residencial');
    await expect(page.locator('.search-results button').first()).toContainText('Residencial');
    await headerSearch.press('ArrowDown');
    await page.locator('.search-results button').first().press('Enter');
    await page.waitForURL('**/b/estates/*');
    await expect(page.locator('app-estate-community-selector')).toBeVisible();
  });
});
