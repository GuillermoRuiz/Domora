import { test, expect } from '../fixtures/auth';

/**
 * Pestaña «Contratos» de la ficha de finca (rol B): estructura del panel, filtros en la URL y que
 * no desborde en ningún ancho ni tema. No depende de que la finca tenga contratos: sin ellos se ve
 * el estado vacío, con ellos la tabla, y en ambos casos las fichas y los filtros.
 */
test.describe('Contratos de la finca', () => {
  async function openContracts(page: import('@playwright/test').Page) {
    await page.goto('/b/estates');
    await page.getByRole('link', { name: 'Ver finca' }).first().click();
    await page.waitForURL('**/b/estates/*');
    await page.locator('.estate-subnav__item', { hasText: 'Contratos' }).click();
    await expect(page.locator('app-contracts-tab')).toBeVisible();
    await expect(page.locator('app-contracts-kpis')).toBeVisible();
  }

  test('fichas, buscador, filtros y «Nuevo contrato»', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openContracts(page);

    await expect(page.locator('[data-kpi]')).toHaveCount(4);
    await expect(page.getByText('Contratos activos', { exact: true })).toBeVisible();
    await expect(page.getByText('Vencen pronto', { exact: true })).toBeVisible();
    await expect(page.getByText('Renovaciones automáticas', { exact: true })).toBeVisible();
    await expect(page.getByText('Importe anual', { exact: true })).toBeVisible();

    await expect(page.getByPlaceholder('Buscar contratos, proveedor o servicio…')).toBeVisible();
    for (const label of ['Vigencia', 'Proveedor', 'Renovación', 'Categoría', 'Vencimiento', 'Ordenar por']) {
      await expect(page.locator('app-contracts-toolbar').getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Nuevo contrato' })).toBeVisible();
    await expect(page.locator('app-contracts-panels').getByText('Próximos vencimientos', { exact: true })).toBeVisible();
    await expect(page.locator('app-contracts-panels').getByText('Últimas renovaciones', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('el buscador se refleja en la URL sin perder la pestaña y se puede quitar', async ({ page }) => {
    await openContracts(page);
    await page.getByPlaceholder('Buscar contratos, proveedor o servicio…').fill('zzz-sin-resultados');
    await expect(page).toHaveURL(/tab=contracts/);
    await expect(page).toHaveURL(/[?&]q=zzz-sin-resultados/);
    const hasContracts = await page.locator('[data-contract]').count();
    if (hasContracts === 0) await expect(page.getByText(/Ningún contrato coincide|aún no tiene contratos/)).toBeVisible();
    await page.getByRole('button', { name: 'Quitar filtros' }).first().click();
    await expect(page).not.toHaveURL(/[?&]q=/);
  });

  test('«Nuevo contrato» abre el formulario y Escape lo cierra', async ({ page }) => {
    await openContracts(page);
    await page.getByRole('button', { name: 'Nuevo contrato' }).click();
    await expect(page.getByRole('dialog', { name: 'Nuevo contrato' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Nuevo contrato' })).toBeHidden();
  });

  test('no desborda horizontalmente en claro y oscuro a 1440, 900, 640 y 390 px', async ({ page }, testInfo) => {
    await openContracts(page);
    for (const theme of ['dark', 'light']) {
      await page.evaluate((value) => document.documentElement.setAttribute('data-theme', value), theme);
      for (const width of [1440, 900, 640, 390]) {
        await page.setViewportSize({ width, height: 900 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${theme} ${width}px`).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`contracts-${theme}-${width}.png`), fullPage: true });
      }
    }
  });
});
