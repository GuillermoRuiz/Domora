import { test, expect } from '../fixtures/auth';

test.use({ serviceWorkers: 'block' });

for (const width of [1440, 768, 390, 320]) {
  test(`header remains stationary while content scrolls at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 330 });
    let scrolledPages = 0;
    for (const path of ['/b/alerts', '/b/estates', '/b/tasks', '/b/accounting', '/b/messages']) {
      await page.goto(path);
      const header = page.locator('.topbar');
      const main = page.locator('.app-main');
      await expect(header).toBeVisible();
      await page.waitForLoadState('networkidle');
      const before = (await header.boundingBox())!;
      const logo = await page.locator('.sidebar__logo').evaluate(el => el.getBoundingClientRect().height);
      const overflow = await main.evaluate(el => el.scrollHeight - el.clientHeight);
      if (overflow <= 0) continue;
      scrolledPages++;
      await main.hover({ position: { x: 20, y: 250 } });
      await page.mouse.wheel(0, 100);
      await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      for (const delta of [0, 100_000, -100_000]) {
        // Target the shell explicitly at the edges: nested tables and panels
        // can consume subsequent wheel events after the first content scroll.
        if (delta) {
          await main.evaluate((el, top) => { el.scrollTop = top; }, delta > 0 ? overflow : 0);
          await expect.poll(() => main.evaluate(el => el.scrollTop)).toBe(delta > 0 ? overflow : 0);
        }
        await expect.poll(async () => (await header.boundingBox())!.y).toBe(before.y);
        const after = (await header.boundingBox())!;
        expect(after).toEqual(before);
        expect(await page.locator('.sidebar__logo').evaluate(el => el.getBoundingClientRect().height)).toBe(logo);
        await expect(page.getByRole('button', { name: 'Abrir menú de cuenta', exact: true })).toBeInViewport();
        if (path === '/b/alerts' && delta > 0) await page.screenshot({ path: testInfo.outputPath('alerts-scrolled.png') });
      }
    }
    expect(scrolledPages).toBeGreaterThan(0);

    // Keep the subscription notice and header aligned even after a resize at
    // the bottom of the page. This must not change the real subscription.
    await page.route('**/auth/me', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), subscriptionStatus: 'Periodo_de_gracia' } });
    });
    await page.goto('/b/alerts');
    const banner = page.locator('.subscription-banner');
    const header = page.locator('.topbar');
    const main = page.locator('.app-main');
    await expect(banner).toBeVisible();
    await page.waitForLoadState('networkidle');
    const headerBefore = await header.boundingBox();
    const bannerBefore = await banner.boundingBox();
    await main.hover({ position: { x: 20, y: 300 } });
    await page.mouse.wheel(0, 100_000);
    await expect.poll(() => main.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => header.boundingBox()).toEqual(headerBefore);
    expect(await banner.boundingBox()).toEqual(bannerBefore);
    await page.setViewportSize({ width: width === 1440 ? 390 : 1440, height: 330 });
    await expect.poll(() => page.evaluate(() => {
      const header = document.querySelector('.topbar')!.getBoundingClientRect();
      const banner = document.querySelector('.subscription-banner')!.getBoundingClientRect();
      const logo = document.querySelector('.sidebar__logo')!.getBoundingClientRect();
      const main = document.querySelector('.app-main')!;
      return { top: Math.abs(header.top - banner.bottom), bottom: Math.abs(header.bottom - logo.bottom), width: Math.abs(header.width - main.clientWidth) };
    })).toEqual({ top: 0, bottom: 0, width: 0 });
    await page.getByRole('button', { name: 'Abrir menú de cuenta', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Modo claro', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });
}
