import { test, expect } from '../fixtures/auth';

/** La comunidad del header se recuerda entre pantallas; Informes con varias comunidades vuelve a «Todas» fuera. */
test('la comunidad elegida se mantiene al cambiar de pantalla y varias en Informes pasan a Todas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const sidebar = (name: string) => page.locator('app-sidebar').getByRole('link', { name, exact: true });
  const checked = page.locator('.topbar select option:checked');

  await page.goto('/b/estates');
  await page.locator('.topbar .scope-trigger').click();
  const first = page.locator('.scope-results button').first();
  const name = (await first.locator('strong').innerText()).trim();
  await first.click();
  await expect(page).toHaveURL(/\/b\/estates\/[^/?]+/);
  await expect(page.locator('.community-selector__trigger')).toContainText(name);

  await sidebar('Juntas').click();
  await expect(page).toHaveURL(/\/b\/juntas\?.*estateId=/);
  await expect(checked).toHaveText(name);

  await sidebar('Tareas').click();
  await expect(checked).toHaveText(name);

  await sidebar('Informes').click();
  const trigger = page.locator('.topbar .scope-trigger');
  await expect(trigger).toContainText(name);
  await trigger.click();
  await page.locator('.scope-estate').filter({ hasNotText: name }).first().click();
  await expect(trigger).toContainText('2 comunidades seleccionadas');
  await page.keyboard.press('Escape');

  await sidebar('Tareas').click();
  await expect(checked).toHaveText('Todas mis comunidades');

  await sidebar('Informes').click();
  await expect(trigger).toContainText('Todas mis comunidades');
  await trigger.click();
  await page.locator('.scope-estate').first().click();
  await page.keyboard.press('Escape');
  const selected = (await trigger.innerText()).trim();
  await sidebar('Contabilidad').click();
  await expect(page).toHaveURL(/\/b\/accounting\/[^/?]+/);
  await expect(page.locator('.community-selector__trigger')).toContainText(selected);

  await page.locator('.community-selector__trigger').click();
  await page.locator('.community-selector__all').click();
  await sidebar('Fincas').click();
  await expect(page).toHaveURL(/\/b\/estates$/);
  expect(errors).toEqual([]);
});
