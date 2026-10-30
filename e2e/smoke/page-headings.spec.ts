import { test, expect } from '../fixtures/auth';

test('Fincas y Juntas comparten tipografía, posición y acción principal', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const measure = () => page.evaluate(() => {
    const header = document.querySelector('.topbar')!.getBoundingClientRect();
    const title = document.querySelector('.page-intro__title, .page-heading h1')!;
    const subtitle = document.querySelector('.page-intro__subtitle, .page-heading p')!;
    const action = document.querySelector('.page-intro__actions button, .page-heading app-btn button')!;
    return { titleSize: getComputedStyle(title).fontSize, subtitleSize: getComputedStyle(subtitle).fontSize,
      titleTop: title.getBoundingClientRect().top - header.bottom, left: title.getBoundingClientRect().left,
      actionTop: action.getBoundingClientRect().top - header.bottom, actionRight: innerWidth - action.getBoundingClientRect().right,
      actionHeight: action.getBoundingClientRect().height };
  });
  await page.goto('/b/juntas');
  await expect(page.getByRole('heading', { name: 'Juntas', exact: true })).toBeVisible();
  const reference = await measure();
  console.info('Juntas heading reference:', reference);
  await page.goto('/b/estates');
  await expect(page.getByRole('heading', { name: 'Fincas', exact: true })).toBeVisible();
  expect(await measure()).toEqual(reference);
});

test('Mensajes mantiene visible el editor después de añadir la cabecera común', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/direct-messages/conversations', route => route.fulfill({ json: [{
    id: 'heading-layout-fixture', otherUserId: 'layout-contact', otherDisplayName: 'Amelia Pérez',
    lastMessagePreview: 'Revisión del espacio de la conversación', unreadCount: 0,
  }] }));
  await page.route('**/direct-messages/conversations/heading-layout-fixture/messages*', route => route.fulfill({ json: [] }));
  await page.goto('/b/messages');
  await page.locator('.conversation-row', { hasText: 'Amelia Pérez' }).click();
  const composer = page.locator('.thread-composer');
  await expect(composer).toBeVisible();
  const bounds = await composer.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);
  await expect(page.getByRole('button', { name: 'Nuevo mensaje', exact: true })).toBeVisible();
});

test('las acciones de subsección usan la cabecera y conservan sus formularios al cambiar de pestaña', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/b/estates');
  await page.getByRole('button', { name: 'Vista tabla', exact: true }).click();
  await page.getByRole('link', { name: 'Residencial Demo', exact: true }).click();
  await expect(page).toHaveURL(/\/b\/estates\/[^/?]+/);
  const estate = new URL(page.url()).pathname.split('/').pop()!;
  const scenarios = [
    { path: `/b/estates/${estate}?tab=documents`, action: 'Subir documento', dialog: 'Subir documento' },
    { path: `/b/estates/${estate}?tab=communications`, action: 'Nuevo comunicado', dialog: 'Nuevo comunicado', tab: 'communications' },
    { path: `/b/estates/${estate}?tab=inspections`, action: 'Nueva inspección', dialog: 'Nueva inspección' },
    { path: `/b/estates/${estate}?tab=providers`, action: 'Nuevo proveedor', dialog: 'Nuevo proveedor' },
    { path: `/b/estates/${estate}?tab=providers`, action: 'Nuevo miembro del personal', dialog: 'Nuevo miembro del personal', staff: true },
    { path: `/b/accounting/${estate}?tab=accounts`, action: 'Nueva cuenta', dialog: 'Nueva cuenta contable' },
    { path: `/b/accounting/${estate}?tab=cost-centres`, action: 'Nuevo centro de coste', dialog: 'Nuevo centro de coste' },
    { path: `/b/accounting/${estate}?tab=journal`, action: 'Asiento manual', dialog: 'Asiento manual' },
  ];
  for (const scenario of scenarios) {
    console.info('Subsection action:', scenario.action);
    if (scenario.staff) {
      await page.locator('.providers-subtab').filter({ hasText: 'Personal' }).click();
      await expect(page.locator('.page-intro__title')).toHaveText('Personal');
    } else if (scenario.tab) await page.locator(`[data-estate-tab="${scenario.tab}"]`).click();
    else await page.goto(scenario.path);
    const action = page.locator('.page-intro__actions').getByRole('button', { name: scenario.action, exact: true });
    await expect(action).toBeVisible();
    await expect(page.getByRole('button', { name: scenario.action, exact: true })).toHaveCount(1);
    await action.click();
    await expect(page.getByRole('heading', { name: scenario.dialog, exact: true })).toBeVisible();
    const close = page.locator('.modal .close-btn');
    if (await close.count()) await close.last().click();
    else await page.locator('.modal').getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
});
