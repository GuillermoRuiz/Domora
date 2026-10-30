import { readFileSync, writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block', hasTouch: true }); // Keep subscription fixtures interceptable; exercise mouse and touch.

const api = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const widths = [1440, 1024, 900, 768, 640, 320];
const accounts = [
  { role: 'A', email: 'superadmin@domora.app', password: 'super123', home: '/a/overview' },
  { role: 'B', email: 'admin@domora.app', password: 'admin123', home: '/b/estates' },
  { role: 'C', email: 'maria.garcia@demo.app', password: 'owner123', home: '/c/properties' },
];

async function theme(page: Page, value: string) {
  if (await page.locator('html').getAttribute('data-theme') === value) return;
  await page.getByRole('button', { name: 'Abrir menú de cuenta', exact: true }).click();
  await page.getByRole('menuitem', { name: value === 'light' ? 'Modo claro' : 'Modo oscuro', exact: true }).click();
}

type Measurement = { path: string; theme: string; width: number; topbar: number; logo: number; delta: number; height: number; look?: Awaited<ReturnType<typeof headerAppearance>>; intro?: Awaited<ReturnType<typeof pageIntroduction>> };

async function pageIntroduction(page: Page) {
  return page.locator('.page-intro').evaluate(intro => {
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    const title = intro.querySelector('.page-intro__title')!;
    const subtitle = intro.querySelector('.page-intro__subtitle')!;
    const text = intro.querySelector('.page-intro__text')!.getBoundingClientRect();
    const action = intro.querySelector('.page-intro__actions button:last-child');
    const rect = title.getBoundingClientRect();
    return { titleSize: getComputedStyle(title).fontSize, subtitleSize: getComputedStyle(subtitle).fontSize,
      titleTop: rect.top - header.bottom, left: rect.left - header.left,
      subtitleLeft: subtitle.getBoundingClientRect().left - rect.left,
      action: action && { right: header.right - action.getBoundingClientRect().right,
        top: action.getBoundingClientRect().top - header.bottom,
        afterText: action.getBoundingClientRect().top - text.bottom,
        height: action.getBoundingClientRect().height },
      overflow: intro.scrollWidth > intro.clientWidth,
    };
  });
}

async function boundary(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.topbar')!;
    const logo = document.querySelector<HTMLElement>('.sidebar__logo')!;
    const main = document.querySelector<HTMLElement>('.app-main')!;
    if (!header || !logo || !main) return { topbar: 0, logo: 0, delta: Infinity, height: 0 };
    // Both boundaries stay fixed in viewport coordinates while content scrolls.
    const topbar = header.getBoundingClientRect().bottom;
    const brand = logo.getBoundingClientRect().bottom;
    return { topbar, logo: brand, delta: Math.abs(topbar - brand), height: header.getBoundingClientRect().height };
  });
}

async function headerAppearance(page: Page) {
  return page.locator('.topbar').evaluate(header => {
    const style = (element: Element) => {
      const css = getComputedStyle(element);
      return { color: css.color, background: css.backgroundColor, fontSize: css.fontSize,
        fontWeight: css.fontWeight, radius: css.borderRadius, padding: css.padding, gap: css.gap };
    };
    const token = (name: string) => getComputedStyle(header).getPropertyValue(name).trim();
    const color = (name: string) => {
      const probe = document.createElement('span'); probe.style.color = token(name); header.append(probe);
      const value = getComputedStyle(probe).color; probe.remove(); return value;
    };
    const control = header.querySelector('.scope-trigger, .community-selector__trigger, .scope-selector, .community-heading__control');
    const icons = control ? [...control.querySelectorAll('app-icon svg')].map(svg => ({ color: getComputedStyle(svg).color,
      width: svg.getBoundingClientRect().width, stroke: svg.getAttribute('stroke-width') })) : [];
    const label = control?.querySelector('select, .community-selector__name, span:not(.sr-only)');
    const actions = [...header.querySelectorAll('.topbar__messages, .topbar__bell')].map(action => ({
      color: getComputedStyle(action).color, width: action.getBoundingClientRect().width,
      height: action.getBoundingClientRect().height, icon: action.querySelector('svg')?.getBoundingClientRect().width,
      stroke: action.querySelector('svg')?.getAttribute('stroke-width') }));
    const navigation = [...document.querySelectorAll('.sidebar__item > app-icon:first-child svg')].map(svg => ({
      width: svg.getBoundingClientRect().width, stroke: svg.getAttribute('stroke-width'),
      inheritsColor: getComputedStyle(svg).color === getComputedStyle(svg.closest('.sidebar__item')!).color,
    }));
    return { control: control && { ...style(control), height: control.getBoundingClientRect().height },
      label: label && style(label), icons, actions, navigation, text: color('--color-text'), accent: color('--color-accent'), muted: color('--color-muted'), surface: color('--color-surface'), actionColor: color('--topbar-muted') };
  });
}

function tabNames(file: string, type: string) {
  const source = readFileSync(file, 'utf8');
  const union = source.match(new RegExp(`type ${type} = ([^;]+);`))![1];
  return [...union.matchAll(/'([^']+)'/g)].map(match => match[1]);
}

for (const account of accounts) {
  test(`header boundary — role ${account.role}: all routes, sections, themes and sizes`, async ({ page, request }, testInfo) => {
    test.setTimeout(600_000);
    const login = await request.post(`${api}/auth/login`, { data: { email: account.email, password: account.password } });
    expect(login.ok(), `Role ${account.role} login: HTTP ${login.status()}`).toBe(true);
    const session = await login.json();
    await page.addInitScript(token => {
      if (!localStorage.getItem('domora-refresh-token')) localStorage.setItem('domora-refresh-token', token);
    }, session.refreshToken);
    const authenticated = { Authorization: `Bearer ${session.accessToken}` };
    const source = readFileSync('src/app/app.routes.ts', 'utf8');
    const paths = new Set([account.home, ...[...source.matchAll(/path: '([abc]\/[^']+)'/g)]
      .map(match => `/${match[1]}`).filter(path => path.startsWith(`/${account.role.toLowerCase()}/`) && !path.includes(':'))]);
    if (account.role === 'B') {
      const estatesResponse = await request.get(`${api}/estates`, { headers: authenticated });
      expect(estatesResponse.ok()).toBe(true);
      const estates = await estatesResponse.json();
      expect(estates.length).toBeGreaterThan(0);
      const estate = estates[0].id;
      for (const tab of tabNames('src/app/core/estate-navigation.service.ts', 'EstateTab')) paths.add(`/b/estates/${estate}?tab=${tab}`);
      for (const tab of tabNames('src/app/core/accounting-navigation.service.ts', 'AccountingTab')) paths.add(`/b/accounting/${estate}?tab=${tab}`);
      const catalogResponse = await request.get(`${api}/reports/catalog`, { headers: authenticated });
      expect(catalogResponse.ok()).toBe(true);
      const catalog = await catalogResponse.json();
      for (const category of catalog.categories) paths.add(`/b/reports/category/${category.key}`);
      for (const report of catalog.reports) paths.add(`/b/reports/view/${report.key}`);
    }
    if (account.role === 'C') {
      const membershipsResponse = await request.get(`${api}/users/${session.user.id}/memberships`, { headers: authenticated });
      expect(membershipsResponse.ok()).toBe(true);
      const memberships = await membershipsResponse.json();
      const property = memberships.find((membership: { propertyId?: string }) => membership.propertyId)?.propertyId;
      expect(property).toBeTruthy();
      for (const tab of ['summary', 'receipts', 'communications', 'juntas', 'reservas']) paths.add(`/c/properties/${property}?tab=${tab}`);
      // Issues and documents left the property tabs for their own sidebar pages.
      for (const page of ['/c/incidencias', '/c/documentacion']) paths.add(page);
    }
    const results: Measurement[] = [];
    const overlays: string[] = [];
    const openedSelectors = new Set<string>();
    try {
      for (const path of paths) {
        await page.goto(path);
        if (path === '/b/migracion') {
          await expect(page.locator('.wizard')).toBeVisible();
          await expect(page.locator('.topbar')).toHaveCount(0);
          overlays.push(path); // Full-screen import assistant, no global header to align.
          continue;
        }
        await expect(page.locator('.topbar')).toBeVisible();
        await page.waitForLoadState('networkidle');
        for (const mode of ['dark', 'light']) {
          await theme(page, mode);
          for (const width of widths) {
            await page.setViewportSize({ width, height: 1000 });
            await page.mouse.move(0, 999); // Compare resting styles after resizing, without a leftover hover.
            await expect.poll(async () => (await boundary(page)).delta, { message: `${path}, ${mode}, ${width}px` }).toBeLessThanOrEqual(0.1);
            await expect.poll(async () => (await boundary(page)).height, { message: `Uniform header: ${path}, ${mode}, ${width}px` }).toBe(width <= 640 ? 157 : width <= 768 ? 120 : 72);
            const overflow = await page.locator('.topbar').evaluate(header => {
              const bounds = header.getBoundingClientRect();
              return [...header.querySelectorAll('button, input, select')].filter(control => {
                const rect = control.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && (rect.top < bounds.top - 0.5 || rect.bottom > bounds.bottom + 0.5 || rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5);
              }).map(control => control.getAttribute('aria-label') || control.className);
            });
            expect(overflow, `Header controls: ${path}, ${mode}, ${width}px`).toEqual([]);
            const look = await headerAppearance(page);
            expect(look.actions, `Global icons: ${path}, ${mode}, ${width}px`).toEqual([
              expect.objectContaining({ width: 36, height: 36, icon: 18, stroke: '2', color: look.actionColor }),
              expect.objectContaining({ width: 36, height: 36, icon: 18, stroke: '2', color: look.actionColor }),
            ]);
            expect(look.actions[0].color).toBe(look.actions[1].color);
            expect(look.navigation.length).toBeGreaterThan(0);
            for (const icon of look.navigation) expect(icon).toEqual({ width: 16, stroke: '2', inheritsColor: true });
            if (look.control) {
              expect(look.control, `Community selector: ${path}, ${mode}, ${width}px`).toEqual(expect.objectContaining({
                height: 44, padding: '10px 14px', gap: '10px', fontSize: '13px', fontWeight: '400', color: look.text, background: look.surface, radius: '10px',
              }));
              expect(look.label).toEqual(expect.objectContaining({ color: look.text, fontSize: '13px', fontWeight: '400' }));
              expect(look.icons, `Selector icons: ${path}, ${mode}, ${width}px`).toEqual([
                expect.objectContaining({ color: look.accent, width: 18, stroke: '2' }),
                expect.objectContaining({ color: look.muted, width: 14, stroke: '2' }),
              ]);
            }
            const dimensions = await boundary(page);
            await expect(page.locator('.page-intro')).toHaveCount(1);
            const intro = await pageIntroduction(page);
            expect(intro, `Page heading: ${path}, ${mode}, ${width}px`).toEqual(expect.objectContaining({
              titleSize: '28px', subtitleSize: '14px', titleTop: width <= 640 ? 16 : 24,
              left: width <= 640 ? 16 : 24, subtitleLeft: 0, overflow: false,
            }));
            if (intro.action) {
              expect(intro.action.right, `Action right: ${path}, ${width}px`).toBe(width <= 640 ? 16 : 24);
              if (width > 640) {
                expect(intro.action.top, `Action top: ${path}, ${width}px`).toBe(37.5);
                expect(intro.action.height).toBe(36);
              } else {
                expect(intro.action.afterText, `Action below title: ${path}, ${width}px`).toBe(16);
                expect(intro.action.height).toBeGreaterThanOrEqual(44);
              }
            }
            results.push({ path, theme: mode, width, ...dimensions, look, intro });
            if (look.control && mode === 'dark' && width === 1440) {
              // Anfitrión del selector: el primer componente `app-*` que lo contiene (sin la propia cabecera), sin lista fija.
              const component = await page.locator('.topbar .community-control__building').evaluate(el => {
                let node = el.parentElement;
                while (node && (!node.tagName.startsWith('APP-') || node.tagName === 'APP-TOPBAR')) node = node.parentElement;
                if (!node) throw new Error('Selector de comunidad fuera de cualquier componente app-*');
                return node.tagName;
              });
              if (!openedSelectors.has(component)) {
                const trigger = page.locator('.topbar select.community-control__label, .topbar button:has(.community-control__building)').first();
                // Mensajes deshabilita el selector mientras carga las comunidades.
                await expect(trigger).toBeEnabled();
                await trigger.press('Enter');
                await expect(trigger).toHaveAttribute('aria-expanded', 'true');
                await expect(page.locator('.topbar .community-control__chevron')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
                await page.keyboard.press('Escape');
                await expect(trigger).toHaveAttribute('aria-expanded', 'false');
                const arrow = await page.locator('.topbar .community-control__chevron').boundingBox();
                expect(arrow).toBeTruthy();
                const x = arrow!.x + arrow!.width / 2, y = arrow!.y + arrow!.height / 2;
                await page.mouse.click(x, y);
                await expect(trigger).toHaveAttribute('aria-expanded', 'true');
                await page.keyboard.press('Escape');
                await expect(trigger).toHaveAttribute('aria-expanded', 'false');
                await page.touchscreen.tap(x, y);
                await expect(trigger).toHaveAttribute('aria-expanded', 'true');
                await page.keyboard.press('Escape');
                await expect(trigger).toHaveAttribute('aria-expanded', 'false');
                await page.locator('.topbar').screenshot({ path: testInfo.outputPath(`${component}-header.png`), animations: 'disabled' });
                openedSelectors.add(component);
                await trigger.evaluate(el => (el as HTMLElement).blur());
              }
            }
            if (path === account.home && [320, 1440].includes(width)) {
              if (width === 320) await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
              await page.screenshot({ path: testInfo.outputPath(`${account.role}-${mode}-${width}.png`), fullPage: true, animations: 'disabled' });
              if (width === 320) await page.locator('.sidebar__backdrop').click({ position: { x: 310, y: 240 } });
            }
          }
        }
      }
      await page.goto(account.home);
      await expect(page.locator('.topbar')).toBeVisible();
      const beforeScroll = await page.locator('.sidebar__logo').evaluate(el => el.getBoundingClientRect().height);
      await page.locator('.app-main').evaluate(el => { el.scrollTop = 300; });
      await expect.poll(async () => (await boundary(page)).delta).toBeLessThanOrEqual(0.1);
      expect(await page.locator('.sidebar__logo').evaluate(el => el.getBoundingClientRect().height)).toBe(beforeScroll);
      // Layout-only fixture: do not modify the actual subscription in the DB.
      if (account.role === 'B') {
        for (const status of ['Periodo_de_gracia', 'Vencida', 'Bloqueada']) {
          await page.route('**/auth/me', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, json: { ...await response.json(), subscriptionStatus: status } });
          });
          await page.goto(account.home);
          await expect(page.locator('.subscription-banner')).toBeVisible();
          for (const width of widths) {
            await page.setViewportSize({ width, height: 1000 });
            await expect.poll(async () => (await boundary(page)).delta).toBeLessThanOrEqual(0.1);
            results.push({ path: `${account.home} [${status}]`, theme: 'light', width, ...await boundary(page) });
          }
          await page.unroute('**/auth/me');
        }
      }
    } finally {
      const result = { role: account.role, screens: paths.size, overlays, measurements: results };
      const artifact = testInfo.outputPath('header-boundaries.json');
      writeFileSync(artifact, JSON.stringify(result, null, 2));
      await testInfo.attach('header-boundaries.json', { path: artifact, contentType: 'application/json' });
      console.info(JSON.stringify({ role: account.role, screens: paths.size, checks: results.length, maxDelta: Math.max(0, ...results.map(row => row.delta)) }));
    }
  });
}
