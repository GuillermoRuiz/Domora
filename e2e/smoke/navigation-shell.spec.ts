import { test, expect } from '../fixtures/auth';

test('navegación global: accesos, cuenta, superficies y responsive', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/b/estates');
  await expect(page.locator('.communities-table')).toBeVisible();
  await expect(page.locator('.sidebar__item-label')).toHaveText([
    'Vista general',
    'Fincas',
    'Juntas',
    'Incidencias',
    'Tareas',
    'Informes',
    'Contabilidad',
  ]);
  await expect(
    page.locator('.sidebar__theme-toggle, .sidebar__logout'),
  ).toHaveCount(0);
  const messages = page.getByRole('button', { name: /^Mensajes/ });
  const bell = page.getByRole('button', {
    name: 'Notificaciones',
    exact: true,
  });
  const account = page.getByRole('button', {
    name: 'Abrir menú de cuenta',
    exact: true,
  });
  await expect(messages.locator('app-icon')).toHaveAttribute('name', 'send');
  await messages.click();
  await expect(page).toHaveURL(/\/b\/messages$/);
  await expect(
    page.locator('.conversation-list, .empty-conversations'),
  ).toBeVisible();
  await page.goto('/b/estates');
  await bell.click();
  await expect(page.locator('.bell-dropdown')).toBeVisible();
  await bell.press('Escape');
  await expect(page.locator('.bell-dropdown')).toHaveCount(0);

  for (const theme of ['dark', 'light'] as const) {
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const path of ['/b/estates', '/b/accounting']) {
      await page.goto(path);
      await expect(page.locator('.topbar')).toBeVisible();
      for (const width of [320, 640, 768, 900, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const geometry = await page.locator('.topbar').evaluate((element) => ({
          scroll: element.scrollWidth,
          width: element.clientWidth,
          background: getComputedStyle(element).backgroundColor,
          sidebar: getComputedStyle(document.querySelector('.sidebar')!)
            .backgroundColor,
          pageWidth: document.documentElement.scrollWidth,
        }));
        expect(
          geometry.scroll,
          `${path} ${theme} ${width}px`,
        ).toBeLessThanOrEqual(geometry.width + 1);
        expect(geometry.pageWidth).toBeLessThanOrEqual(width);
        expect(geometry.background).toBe(geometry.sidebar);
        await expect(messages).toBeVisible();
        await expect(bell).toBeVisible();
        await expect(account).toBeVisible();
        if (width <= 900) {
          await page
            .getByRole('button', { name: 'Abrir menú', exact: true })
            .click();
          await expect(page.locator('.sidebar')).toHaveClass(/sidebar--open/);
          await page
            .locator('.sidebar__backdrop')
            .click({ position: { x: width - 10, y: 200 } });
          await expect(page.locator('.sidebar')).not.toHaveClass(
            /sidebar--open/,
          );
        }
        if (path === '/b/estates' && [320, 1440].includes(width)) {
          await page.screenshot({
            path: testInfo.outputPath(`navigation-${theme}-${width}.png`),
            animations: 'disabled',
            fullPage: true,
          });
        }
      }
    }
    if (theme === 'dark') {
      await account.click();
      await page
        .getByRole('menuitem', { name: 'Modo claro', exact: true })
        .click();
      await expect(account).toBeFocused();
    }
  }

  await account.focus();
  await account.press('Enter');
  await expect(
    page.getByRole('menuitem', { name: 'Mi perfil', exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath('navigation-account-menu.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('ArrowDown');
  await expect(
    page.getByRole('menuitem', { name: 'Configuración', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(account).toBeFocused();
  await account.press('Space');
  await page
    .getByRole('menuitem', { name: 'Configuración', exact: true })
    .click();
  await expect(page).toHaveURL(/\/b\/settings$/);
  await expect(
    page.getByRole('link', { name: 'Ver detalles' }),
  ).toHaveAttribute('href', '/b/subscription');
  await expect(page.getByText('Razón social', { exact: true })).toBeVisible();
  await expect(page.locator('.notif-head')).toBeVisible();
  await account.click();
  await page
    .getByRole('menuitem', { name: 'Cerrar sesión', exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});
