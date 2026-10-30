import { test, expect } from '@playwright/test';

const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000/api/v1';

for (const account of [
  {
    role: 'a',
    email: process.env.E2E_SUPERADMIN_EMAIL ?? 'superadmin@domora.app',
    password: process.env.E2E_SUPERADMIN_PASSWORD ?? 'super123',
    home: 'overview',
    labels: [
      'Vista general',
      'Administradores de fincas',
      'Clientes',
      'Facturación y cobros',
      'Analítica y adopción',
      'Onboarding y completitud',
      'Soporte e incidencias',
      'Comunidades',
      'Usuarios y accesos',
      'Configuración',
      'Seguridad y auditoría',
    ],
  },
  {
    role: 'c',
    email: process.env.E2E_OWNER_EMAIL ?? 'maria.garcia@demo.app',
    password: process.env.E2E_OWNER_PASSWORD ?? 'owner123',
    home: 'community',
    labels: [
      'Mi comunidad',
      'Incidencias',
      'Documentación',
      'Mensajes',
      'Juntas',
      'Recibos y pagos',
      'Mi perfil',
    ],
  },
]) {
  test(`rol ${account.role.toUpperCase()}: conserva navegación y acciones en teléfono`, async ({
    page,
    request,
  }, testInfo) => {
    const response = await request.post(`${api}/auth/login`, {
      data: { email: account.email, password: account.password },
    });
    expect(response.ok()).toBe(true);
    const { refreshToken } = await response.json();
    await page.addInitScript(
      (token) => localStorage.setItem('domora-refresh-token', token),
      refreshToken,
    );
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/${account.role}/${account.home}`);
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.sidebar__item-label')).toHaveText(
      account.labels,
    );
    const messages = page.getByRole('button', { name: /^Mensajes/ });
    const avatar = page.getByRole('button', {
      name: 'Abrir menú de cuenta',
      exact: true,
    });
    for (const theme of ['dark', 'light']) {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const widths = await page.locator('.topbar').evaluate((header) => ({
        scroll: header.scrollWidth,
        client: header.clientWidth,
        page: document.documentElement.scrollWidth,
      }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
      expect(widths.page).toBeLessThanOrEqual(320);
      await expect(messages).toBeVisible();
      await expect(avatar).toBeVisible();
      if (account.role === 'c')
        await expect(
          page.locator('.topbar app-community-scope-selector'),
        ).toBeVisible();
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(
          `navigation-${account.role}-${theme}-320.png`,
        ),
        fullPage: true,
      });
      await page
        .getByRole('button', { name: 'Abrir menú', exact: true })
        .click();
      await expect(page.locator('.sidebar')).toHaveClass(/sidebar--open/);
      await expect(page.locator('.sidebar__item')).toHaveCount(
        account.labels.length,
      );
      await expect(
        page.getByRole('link', { name: account.labels[0], exact: true }),
      ).toBeVisible();
      await page.screenshot({
        animations: 'disabled',
        path: testInfo.outputPath(
          `navigation-${account.role}-${theme}-sidebar.png`,
        ),
        fullPage: true,
      });
      await page
        .locator('.sidebar__backdrop')
        .click({ position: { x: 310, y: 200 } });
      await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar--open/);
      if (theme === 'dark') {
        await avatar.click();
        await page
          .getByRole('menuitem', { name: 'Modo claro', exact: true })
          .click();
      }
    }
    await messages.click();
    await expect(page).toHaveURL(new RegExp(`/${account.role}/messages$`));
    await avatar.click();
    await page
      .getByRole('menuitem', { name: 'Configuración', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${account.role}/settings$`));
  });
}
