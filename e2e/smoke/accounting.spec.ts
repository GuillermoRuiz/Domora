import { test, expect } from '../fixtures/auth';

const isMobile = (projectName: string) => projectName.startsWith('mobile-');

/**
 * Flujo 3 de 4 de la fase 6 (ID 29). Área con más tests de backend (2.249
 * specs, ver ID 30) y cero cobertura de navegador hasta ahora. Ejercita el
 * listado de comunidades de Contabilidad, el selector de comunidad del
 * detalle y la subnavegación por apartados (Cobros y tesorería → Recibos).
 */
test.describe('Contabilidad', () => {
  test('dashboard de contabilidad y detalle de finca con tab de Recibos', async ({ page }, testInfo) => {
    await page.goto('/b/accounting');
    await expect(page.getByRole('heading', { name: 'Contabilidad', exact: true })).toBeVisible();
    await expect(page.getByText('saldo consolidado')).toBeVisible();

    // Tabla en escritorio, tarjetas en móvil: se abre la primera comunidad visible.
    const firstEstate = page.locator('app-accounting-overview-views').locator('button.community-name, [aria-label^="Abrir "]').filter({ visible: true }).first();
    const estateName = (await firstEstate.innerText()).trim() || (await firstEstate.getAttribute('aria-label'))!.replace(/^Abrir /, '');
    await firstEstate.click();
    await page.waitForURL('**/b/accounting/*');
    await expect(page.locator('app-accounting-community-selector .community-selector__name')).toHaveText(estateName);

    if (isMobile(testInfo.project.name)) await page.locator('.topbar__menu-btn').click();
    await page.locator('.sidebar').getByRole('button', { name: 'Cobros y tesorería', exact: true }).click();
    const recibosTab = page.locator('.accounting-subnav__item', { hasText: 'Recibos' });
    await recibosTab.click();
    await expect(recibosTab).toHaveClass(/accounting-subnav__item--active/);
    await expect(recibosTab).toHaveAttribute('aria-current', 'page');
  });
});
